/** Album purchase orders (COM-002..006, COM-010, COM-013). */
import { sql } from 'kysely';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { ReleaseSnapshot } from '../../platform/db/schema.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { metrics } from '../../platform/metrics.js';
import { activeGrants } from '../catalog/index.js';
import { getUser } from '../identity/index.js';
import { includedTax } from './ledger.js';
import type { PaymentProvider } from './provider.js';
import {
  ORDER_TTL_MS,
  TERMS_VERSION,
  offerView,
  orderView,
  ownsRelease,
  purchaseTerms,
  releaseTracks,
  sellable,
  setStatus,
} from './shared.js';

/**
 * Recordings the user could buy now in their territory: on a release whose offer
 * is on sale there and which is sellable as a whole. Used to say "available for
 * purchase" instead of "subscription required" (PLY-005).
 */
export async function purchasableRecordings(
  db: DbOrTx,
  recordingIds: readonly string[],
  territory: string,
  now: Date,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (recordingIds.length === 0) return out;
  const rows = await db
    .selectFrom('offer as o')
    .innerJoin('release_track as t', 't.release_id', 'o.release_id')
    .select(['o.release_id', 't.recording_id'])
    .where('o.status', '=', 'on_sale')
    .where(sql<boolean>`${territory} = ANY(o.territories)`)
    .where('o.release_id', 'in', (eb) =>
      eb
        .selectFrom('release_track')
        .select('release_id')
        .where('recording_id', 'in', [...recordingIds]),
    )
    .execute();
  const byRelease = new Map<string, string[]>();
  for (const r of rows)
    byRelease.set(r.release_id, [...(byRelease.get(r.release_id) ?? []), r.recording_id]);
  const grants = await activeGrants(
    db,
    rows.map((r) => r.recording_id),
    territory,
    'stream',
    now,
  );
  const wanted = new Set(recordingIds);
  for (const tracks of byRelease.values()) {
    if (!tracks.every((id) => grants.has(id))) continue;
    for (const id of tracks) if (wanted.has(id)) out.add(id);
  }
  return out;
}

/** The release's offer for the caller's licence territory, or 404. Prices are server-side (COM-013). */
export async function offerForRelease(db: Db, userId: Principal['userId'], releaseId: string) {
  const country = (await getUser(db, userId))?.license_country;
  if (!country) throw errors.notFound();
  const offer = await db
    .selectFrom('offer')
    .selectAll()
    .where('release_id', '=', releaseId)
    .where('status', '=', 'on_sale')
    .executeTakeFirst();
  if (!offer?.territories.includes(country)) throw errors.notFound();
  if (!(await sellable(db, await releaseTracks(db, releaseId), country, new Date()))) {
    throw errors.notFound();
  }
  const pending = await db
    .selectFrom('purchase_order')
    .select('id')
    .where('user_id', '=', userId)
    .where('offer_id', '=', offer.id)
    .where('status', '=', 'pending')
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  return {
    ...offerView(offer),
    owned: await ownsRelease(db, userId, releaseId),
    pending_order_id: pending?.id ?? null,
    terms: purchaseTerms(),
  };
}

/**
 * Opens an order at the server's price with a frozen snapshot (COM-002, COM-013)
 * and a checkout at the provider. A second call for the same offer while one is
 * pending returns that order, so a closed tab never leads to paying twice (COM-010).
 */
export async function createOrder(
  db: Db,
  provider: PaymentProvider,
  principal: Principal,
  input: { offer_id: string; confirm_already_owned: boolean },
  correlationId: string,
): Promise<{ status: 200 | 201; body: ReturnType<typeof orderView> }> {
  const result = await db.transaction().execute(async (tx) => {
    const now = new Date();
    const offer = await tx
      .selectFrom('offer')
      .selectAll()
      .where('id', '=', input.offer_id)
      .forShare()
      .executeTakeFirst();
    const country = (await getUser(tx, principal.userId))?.license_country;
    if (!offer || !country || !offer.territories.includes(country)) throw errors.notFound();
    if (offer.status !== 'on_sale') throw errors.invalidState('This release is no longer on sale.');

    await tx
      .updateTable('purchase_order')
      .set((eb) => ({ status: 'expired', version: eb('version', '+', 1), updated_at: now }))
      .where('user_id', '=', principal.userId)
      .where('offer_id', '=', offer.id)
      .where('status', '=', 'pending')
      .where('expires_at', '<=', now)
      .execute();
    const pending = await tx
      .selectFrom('purchase_order')
      .selectAll()
      .where('user_id', '=', principal.userId)
      .where('offer_id', '=', offer.id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) return { status: 200 as const, order: pending };

    const recordingIds = await releaseTracks(tx, offer.release_id);
    if (!(await sellable(tx, recordingIds, country, now))) {
      throw errors.denied('RIGHTS_UNAVAILABLE', 'This release cannot be sold in your region.');
    }
    if (
      !input.confirm_already_owned &&
      (await ownsRelease(tx, principal.userId, offer.release_id))
    ) {
      throw errors.alreadyExists(
        'You already own this release. Set confirm_already_owned to buy it again.',
      );
    }
    const release = await tx
      .selectFrom('release')
      .select('title')
      .where('id', '=', offer.release_id)
      .executeTakeFirstOrThrow();
    const artists = await tx
      .selectFrom('release_artist as ra')
      .innerJoin('music_entity as m', 'm.id', 'ra.artist_id')
      .select('m.display_name')
      .where('ra.release_id', '=', offer.release_id)
      .orderBy('ra.ord')
      .execute();
    const tax = includedTax(offer.price_minor, offer.vat_rate_bp);
    const snapshot: ReleaseSnapshot = {
      kind: 'release',
      release_id: offer.release_id,
      release_title: release.title,
      artist_names: artists.map((a) => a.display_name),
      recording_ids: recordingIds,
      territory: country,
      currency: offer.currency,
      amount_minor: offer.price_minor,
      tax_minor: tax,
      vat_rate_bp: offer.vat_rate_bp,
      capabilities: offer.capabilities,
      terms_version: TERMS_VERSION,
    };
    const orderId = newId('order');
    await tx
      .insertInto('purchase_order')
      .values({
        id: orderId,
        user_id: principal.userId,
        offer_id: offer.id,
        offer_version: offer.version,
        status: 'pending',
        currency: offer.currency,
        amount_minor: offer.price_minor,
        tax_minor: tax,
        snapshot: JSON.stringify(snapshot),
        provider: provider.name,
        checkout_ref: null,
        checkout_url: null,
        entitlement_id: null,
        expires_at: new Date(now.getTime() + ORDER_TTL_MS),
        paid_at: null,
        refunded_at: null,
      })
      .execute();
    const checkout = await provider.createCheckout(tx, {
      orderId,
      amountMinor: offer.price_minor,
      currency: offer.currency,
    });
    const order = await tx
      .updateTable('purchase_order')
      .set({ checkout_ref: checkout.checkoutRef, checkout_url: checkout.checkoutUrl })
      .where('id', '=', orderId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'order.created',
      subjectType: 'order',
      subjectId: orderId,
      correlationId,
      details: { offer_id: offer.id, amount_minor: offer.price_minor, currency: offer.currency },
    });
    return { status: 201 as const, order };
  });
  if (result.status === 201) metrics.orders.inc({ event: 'created' });
  return { status: result.status, body: orderView(result.order) };
}

export async function listOrders(db: DbOrTx, userId: string) {
  const rows = await db
    .selectFrom('purchase_order')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(100)
    .execute();
  return { items: rows.map(orderView) };
}

/** Another user's order is "not found" (PLY-005 pattern). */
export async function getOrder(db: DbOrTx, userId: string, orderId: string) {
  const o = await db
    .selectFrom('purchase_order')
    .selectAll()
    .where('id', '=', orderId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!o) throw errors.notFound();
  return orderView(o);
}

/** The buyer abandons a pending order. A payment that still arrives is refunded. */
export async function cancelOrder(
  db: Db,
  principal: Principal,
  orderId: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const o = await tx
      .selectFrom('purchase_order')
      .selectAll()
      .where('id', '=', orderId)
      .where('user_id', '=', principal.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!o) throw errors.notFound();
    if (o.status !== 'pending')
      throw errors.invalidState(`A ${o.status} order cannot be cancelled.`);
    const updated = await setStatus(tx, o, 'cancelled');
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'order.cancelled',
      subjectType: 'order',
      subjectId: orderId,
      correlationId,
    });
    metrics.orders.inc({ event: 'cancelled' });
    return orderView(updated);
  });
}

/** Scheduled: pending orders past their checkout window become expired. */
export async function expireOrders(db: Db): Promise<number> {
  const rows = await db
    .updateTable('purchase_order')
    .set((eb) => ({ status: 'expired', version: eb('version', '+', 1), updated_at: new Date() }))
    .where('status', '=', 'pending')
    .where('expires_at', '<=', new Date())
    .returning('id')
    .execute();
  if (rows.length > 0) metrics.orders.inc({ event: 'expired' }, rows.length);
  return rows.length;
}

/** Account deletion: pending orders end; paid orders and the ledger stay (legal, finance). */
export async function cancelPendingOrders(db: DbOrTx, userId: string) {
  await db
    .updateTable('purchase_order')
    .set((eb) => ({ status: 'cancelled', version: eb('version', '+', 1), updated_at: new Date() }))
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .execute();
}
