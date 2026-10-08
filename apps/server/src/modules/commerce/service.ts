import { createHash } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type {
  OfferTable,
  OrderStatus,
  PurchaseOrderTable,
  ReleaseSnapshot,
  SubscriptionSnapshot,
} from '../../platform/db/schema.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import type { Logger } from '../../platform/logger.js';
import { metrics } from '../../platform/metrics.js';
import { activeGrants } from '../catalog/index.js';
import {
  activateSubscriptionPeriod,
  endSubscriptionNow,
  getSubscription,
  issuePurchaseEntitlement,
  markSubscriptionPastDue,
  revokePurchaseEntitlement,
  resumeSubscriptionRenewal,
  stopSubscriptionRenewal,
} from '../entitlement/index.js';
import { getUser } from '../identity/index.js';
import { includedTax, postRefund, postSale } from './ledger.js';
import type { PaymentProvider, ProviderEvent } from './provider.js';

type OfferRow = Selectable<OfferTable>;
type OrderRow = Selectable<PurchaseOrderTable>;

/** How long a checkout stays open. A payment confirmed later is still honoured. */
export const ORDER_TTL_MS = 30 * 60_000;
/** Purchase terms shown before payment (COM-012); provisional until legal review. */
export const TERMS_VERSION = 'purchase-terms-2026-10-provisional';
export const APPLY_EVENT_JOB = 'commerce.payment_event.apply';
export const SUBMIT_REFUND_JOB = 'commerce.refund.submit';
/** Default VAT for Korea (10 %), in basis points. */
export const KR_VAT_BP = 1000;
export const SUBSCRIPTION_TERMS_VERSION = 'subscription-terms-2026-10-provisional';
export const RENEW_JOB = 'commerce.renew_subscriptions';
/** Renewal is charged this long before the paid-through date. */
export const RENEW_AHEAD_MS = 24 * 3_600_000;

export interface PlanConfig {
  plan: string;
  priceMinor: number;
}

export function offerView(o: OfferRow) {
  return {
    offer_id: o.id,
    release_id: o.release_id,
    territories: o.territories,
    price: {
      amount_minor: o.price_minor,
      currency: o.currency,
      tax_minor: includedTax(o.price_minor, o.vat_rate_bp),
      tax_included: true,
    },
    capabilities: o.capabilities,
    status: o.status,
    version: o.version,
  };
}

export function orderView(o: OrderRow) {
  const snap = o.snapshot;
  const release = snap.kind === 'subscription' ? null : snap;
  return {
    order_id: o.id,
    kind: o.kind,
    status: o.status,
    offer_id: o.offer_id,
    release_id: release?.release_id ?? null,
    release_title: release?.release_title ?? null,
    artist_names: release?.artist_names ?? [],
    plan: snap.kind === 'subscription' ? snap.plan : null,
    renewal: snap.kind === 'subscription' ? snap.renewal : false,
    price: {
      amount_minor: o.amount_minor,
      currency: o.currency,
      tax_minor: o.tax_minor,
      tax_included: true,
    },
    capabilities: snap.capabilities,
    terms_version: snap.terms_version,
    checkout_url: o.status === 'pending' ? o.checkout_url : null,
    entitlement_id: o.entitlement_id,
    created_at: o.created_at.toISOString(),
    expires_at: o.expires_at.toISOString(),
    paid_at: o.paid_at?.toISOString() ?? null,
    refunded_at: o.refunded_at?.toISOString() ?? null,
    version: o.version,
  };
}

/** What the buyer is told before paying (COM-012): not a copyright transfer. */
export function purchaseTerms() {
  return {
    terms_version: TERMS_VERSION,
    summary: [
      'You buy the right to play this release in Rabit, not the copyright in it.',
      'The purchase is independent of any subscription and stays when a subscription ends.',
      'If the rights holder withdraws the release, playback may stop; the purchase is then refunded.',
      'Downloads are not included.',
    ],
  };
}

async function releaseTracks(db: DbOrTx, releaseId: string) {
  return db
    .selectFrom('release_track')
    .select('recording_id')
    .where('release_id', '=', releaseId)
    .orderBy('disc_no')
    .orderBy('position')
    .execute()
    .then((rows) => rows.map((r) => r.recording_id));
}

/** A release order can still be fulfilled: its offer is on sale and the release sellable. */
async function releaseStillSellable(
  tx: DbOrTx,
  offerId: string | null,
  snap: ReleaseSnapshot,
  now: Date,
) {
  if (!offerId) return false;
  const offer = await tx
    .selectFrom('offer')
    .select('status')
    .where('id', '=', offerId)
    .executeTakeFirst();
  return (
    offer?.status === 'on_sale' && (await sellable(tx, snap.recording_ids, snap.territory, now))
  );
}

/** Sellable in a territory: every track has an active stream grant there now. */
async function sellable(db: DbOrTx, recordingIds: string[], territory: string, now: Date) {
  if (recordingIds.length === 0) return false;
  const grants = await activeGrants(db, recordingIds, territory, 'stream', now);
  return recordingIds.every((id) => grants.has(id));
}

async function ownsRelease(db: DbOrTx, userId: string, releaseId: string) {
  const row = await db
    .selectFrom('entitlement')
    .select('id')
    .where('user_id', '=', userId)
    .where('origin', '=', 'purchase')
    .where('scope', '=', 'release')
    .where('resource_id', '=', releaseId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row !== undefined;
}

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

async function setStatus(
  tx: DbOrTx,
  o: OrderRow,
  status: OrderStatus,
  extra: Partial<{ entitlement_id: string; paid_at: Date; refunded_at: Date }> = {},
) {
  return tx
    .updateTable('purchase_order')
    .set({ status, ...extra, version: o.version + 1, updated_at: new Date() })
    .where('id', '=', o.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// ---- provider events (COM-004, COM-005) ----

export type ReceiveOutcome = 'received' | 'duplicate';

/**
 * Stores a verified provider event and queues it; the caller acknowledges right
 * after. Applying happens in a job, so a slow or failing apply never makes the
 * provider retry, and a retried delivery is recognised by its event id.
 */
export async function receiveEvent(
  db: Db,
  provider: PaymentProvider,
  event: ProviderEvent,
  rawBody: string,
): Promise<ReceiveOutcome> {
  const outcome = await db.transaction().execute(async (tx) => {
    const id = newId('paymentEvent');
    const inserted = await tx
      .insertInto('payment_event')
      .values({
        id,
        provider: provider.name,
        provider_event_id: event.eventId,
        type: event.type,
        checkout_ref: event.checkoutRef,
        payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
        payload: JSON.stringify(event),
        status: 'received',
        detail: null,
        processed_at: null,
      })
      .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return 'duplicate' as const;
    await enqueue(tx, {
      kind: APPLY_EVENT_JOB,
      payload: { payment_event_id: id },
      dedupeKey: `${APPLY_EVENT_JOB}:${id}`,
    });
    return 'received' as const;
  });
  metrics.paymentEvents.inc({ provider: provider.name, type: event.type, outcome });
  return outcome;
}

type Applied = { status: 'applied' | 'ignored' | 'held'; detail: string };

/**
 * Applies one stored event in a single transaction: event status, order state,
 * entitlement, ledger and outbox commit together (COM-006). Amount or currency
 * mismatches and unknown references are held for an operator, never applied.
 */
export async function applyEvent(
  db: Db,
  log: Logger,
  paymentEventId: string,
): Promise<Applied | null> {
  const result = await db.transaction().execute(async (tx) => {
    const ev = await tx
      .selectFrom('payment_event')
      .selectAll()
      .where('id', '=', paymentEventId)
      .forUpdate()
      .executeTakeFirst();
    if (!ev || ev.status !== 'received') return null;
    const e = ev.payload as unknown as ProviderEvent;
    const order = await tx
      .selectFrom('purchase_order')
      .selectAll()
      .where('provider', '=', ev.provider)
      .where('checkout_ref', '=', e.checkoutRef)
      .forUpdate()
      .executeTakeFirst();
    const r: Applied = order
      ? await applyToOrder(tx, order, e, ev.id)
      : { status: 'held', detail: 'unknown_checkout' };
    await tx
      .updateTable('payment_event')
      .set({ status: r.status, detail: r.detail, processed_at: new Date() })
      .where('id', '=', ev.id)
      .execute();
    return { ...r, provider: ev.provider, type: ev.type, orderId: order?.id ?? null };
  });
  if (!result) return null;
  metrics.paymentEvents.inc({
    provider: result.provider,
    type: result.type,
    outcome: result.status,
  });
  if (result.status === 'held') {
    log.warn(
      { payment_event_id: paymentEventId, order_id: result.orderId, detail: result.detail },
      'payment event held for review',
    );
  }
  return { status: result.status, detail: result.detail };
}

async function applyToOrder(
  tx: DbOrTx,
  order: OrderRow,
  e: ProviderEvent,
  eventId: string,
): Promise<Applied> {
  const correlationId = eventId;
  switch (e.type) {
    case 'payment.succeeded': {
      if (e.amountMinor !== order.amount_minor || e.currency !== order.currency) {
        return { status: 'held', detail: 'amount_mismatch' };
      }
      if (!['pending', 'expired', 'cancelled'].includes(order.status)) {
        return { status: 'ignored', detail: `already_${order.status}` };
      }
      const now = new Date();
      await postSale(tx, order);
      const snap = order.snapshot;
      const fulfillable =
        order.status !== 'cancelled' &&
        (snap.kind === 'subscription' ||
          (await releaseStillSellable(tx, order.offer_id, snap, now)));
      if (!fulfillable) {
        // Money arrived for something we no longer sell or the buyer cancelled.
        const paid = await setStatus(tx, order, 'refund_pending', { paid_at: now });
        await startRefund(
          tx,
          paid,
          'system',
          'Payment arrived after the order could no longer be fulfilled.',
        );
        metrics.orders.inc({ event: 'paid_unfulfillable' });
        return { status: 'applied', detail: 'refunding' };
      }
      const entitlementId =
        snap.kind === 'subscription'
          ? await activateSubscriptionPeriod(
              tx,
              { userId: order.user_id, plan: snap.plan, months: snap.period_months },
              correlationId,
            )
          : await issuePurchaseEntitlement(
              tx,
              {
                userId: order.user_id,
                releaseId: snap.release_id,
                capabilities: snap.capabilities,
                orderId: order.id,
              },
              correlationId,
            );
      await setStatus(tx, order, 'fulfilled', { paid_at: now, entitlement_id: entitlementId });
      await audit(tx, {
        actorType: 'system',
        actorId: null,
        action: 'order.fulfilled',
        subjectType: 'order',
        subjectId: order.id,
        correlationId,
        details: { entitlement_id: entitlementId, late: order.status === 'expired' },
      });
      metrics.orders.inc({ event: 'fulfilled' });
      return { status: 'applied', detail: 'fulfilled' };
    }
    case 'payment.failed': {
      if (order.status !== 'pending')
        return { status: 'ignored', detail: `already_${order.status}` };
      await setStatus(tx, order, 'cancelled');
      // A declined renewal: no access until the user pays again.
      if (order.snapshot.kind === 'subscription' && order.snapshot.renewal) {
        await markSubscriptionPastDue(tx, order.user_id, correlationId);
      }
      metrics.orders.inc({ event: 'payment_failed' });
      return { status: 'applied', detail: 'payment_failed' };
    }
    case 'refund.succeeded':
    case 'refund.failed': {
      const refund = e.refundRef
        ? await tx
            .selectFrom('payment_refund')
            .selectAll()
            .where('order_id', '=', order.id)
            .where('provider_ref', '=', e.refundRef)
            .forUpdate()
            .executeTakeFirst()
        : undefined;
      if (!refund) return { status: 'held', detail: 'unknown_refund' };
      if (refund.status !== 'requested')
        return { status: 'ignored', detail: `refund_${refund.status}` };
      if (e.amountMinor !== refund.amount_minor)
        return { status: 'held', detail: 'amount_mismatch' };
      const succeeded = e.type === 'refund.succeeded';
      await tx
        .updateTable('payment_refund')
        .set({ status: succeeded ? 'succeeded' : 'failed', updated_at: new Date() })
        .where('id', '=', refund.id)
        .execute();
      if (succeeded) {
        await postRefund(tx, order);
        if (order.kind === 'subscription' && order.entitlement_id) {
          await endSubscriptionNow(tx, order.user_id, correlationId);
        } else if (order.entitlement_id) {
          await revokePurchaseEntitlement(tx, order.entitlement_id, correlationId);
        }
        await setStatus(tx, order, 'refunded', { refunded_at: new Date() });
        metrics.orders.inc({ event: 'refunded' });
      } else {
        // Back to where it was: entitled if it had been fulfilled, otherwise paid
        // and waiting for an operator.
        await setStatus(tx, order, order.entitlement_id ? 'fulfilled' : 'paid');
        metrics.orders.inc({ event: 'refund_failed' });
      }
      await audit(tx, {
        actorType: 'system',
        actorId: null,
        action: succeeded ? 'order.refunded' : 'order.refund_failed',
        subjectType: 'order',
        subjectId: order.id,
        correlationId,
        details: { refund_id: refund.id },
      });
      return { status: 'applied', detail: succeeded ? 'refunded' : 'refund_failed' };
    }
  }
}

/** Records a full refund request; the provider is called by a job after commit. */
async function startRefund(tx: DbOrTx, order: OrderRow, requestedBy: string, reason: string) {
  const refundId = newId('refund');
  await tx
    .insertInto('payment_refund')
    .values({
      id: refundId,
      order_id: order.id,
      amount_minor: order.amount_minor,
      status: 'requested',
      provider_ref: null,
      requested_by: requestedBy,
      reason,
    })
    .execute();
  await enqueue(tx, {
    kind: SUBMIT_REFUND_JOB,
    payload: { refund_id: refundId },
    dedupeKey: `${SUBMIT_REFUND_JOB}:${refundId}`,
  });
  return refundId;
}

/** Operator-initiated full refund of a paid order (partial refunds are not offered yet). */
export async function requestRefund(
  db: Db,
  operator: Principal,
  orderId: string,
  expectedVersion: number,
  reason: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const o = await tx
      .selectFrom('purchase_order')
      .selectAll()
      .where('id', '=', orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!o) throw errors.notFound();
    if (o.version !== expectedVersion) throw errors.preconditionFailed();
    if (o.status !== 'fulfilled' && o.status !== 'paid') {
      throw errors.invalidState(`A ${o.status} order cannot be refunded.`);
    }
    const updated = await setStatus(tx, o, 'refund_pending');
    const refundId = await startRefund(tx, updated, `operator:${operator.userId}`, reason);
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'order.refund_requested',
      subjectType: 'order',
      subjectId: orderId,
      reason,
      correlationId,
      details: { refund_id: refundId, amount_minor: o.amount_minor },
    });
    return orderView(updated);
  });
}

/** Job: asks the provider for a requested refund once (idempotent on provider_ref). */
export async function submitRefund(db: Db, provider: PaymentProvider, refundId: string) {
  await db.transaction().execute(async (tx) => {
    const r = await tx
      .selectFrom('payment_refund as r')
      .innerJoin('purchase_order as o', 'o.id', 'r.order_id')
      .select(['r.id', 'r.status', 'r.provider_ref', 'r.amount_minor', 'o.checkout_ref'])
      .where('r.id', '=', refundId)
      .forUpdate()
      .executeTakeFirst();
    if (!r || r.status !== 'requested' || r.provider_ref || !r.checkout_ref) return;
    const { providerRef } = await provider.requestRefund(tx, {
      refundId: r.id,
      checkoutRef: r.checkout_ref,
      amountMinor: r.amount_minor,
    });
    await tx
      .updateTable('payment_refund')
      .set({ provider_ref: providerRef, updated_at: new Date() })
      .where('id', '=', r.id)
      .execute();
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

export type Mismatch = { order_id: string; kind: string };

/**
 * Scheduled reconciliation against the provider (ADR-0018). Reports, never
 * repairs: each mismatch is counted, logged and left for an operator.
 */
export async function reconcile(
  db: Db,
  provider: PaymentProvider,
  log: Logger,
  since = new Date(Date.now() - 7 * 86_400_000),
): Promise<Mismatch[]> {
  const orders = await db
    .selectFrom('purchase_order')
    .select(['id', 'status', 'checkout_ref', 'amount_minor', 'currency'])
    .where('provider', '=', provider.name)
    .where('updated_at', '>=', since)
    .orderBy('updated_at', 'desc')
    .limit(1000)
    .execute();
  const out: Mismatch[] = [];
  for (const o of orders) {
    if (!o.checkout_ref) continue;
    const p = await provider.lookup(db, o.checkout_ref);
    let kind: string | null = null;
    const paidHere = ['paid', 'fulfilled', 'refund_pending', 'refunded'].includes(o.status);
    if (!p) kind = 'missing_at_provider';
    else if (p.amountMinor !== o.amount_minor || p.currency !== o.currency) kind = 'amount';
    else if (p.state === 'succeeded' && !paidHere) kind = 'payment_not_recorded';
    else if ((p.state === 'open' || p.state === 'failed') && paidHere)
      kind = 'paid_without_payment';
    else if (p.state === 'refunded' && o.status === 'fulfilled') kind = 'refund_not_recorded';
    if (kind) {
      out.push({ order_id: o.id, kind });
      metrics.paymentReconcileMismatches.inc({ kind });
      log.warn({ order_id: o.id, kind }, 'payment reconciliation mismatch');
    }
  }
  return out;
}

// ---- operator ----

export async function createOffer(
  db: Db,
  operator: Principal,
  input: {
    release_id: string;
    territories: string[];
    price_minor: number;
    vat_rate_bp: number;
    reason: string;
  },
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const release = await tx
      .selectFrom('release')
      .select('id')
      .where('id', '=', input.release_id)
      .executeTakeFirst();
    if (!release) throw errors.notFound();
    const existing = await tx
      .selectFrom('offer')
      .select('id')
      .where('release_id', '=', input.release_id)
      .where('status', '=', 'on_sale')
      .executeTakeFirst();
    if (existing)
      throw errors.alreadyExists('This release already has an offer on sale; withdraw it first.');
    const offer = await tx
      .insertInto('offer')
      .values({
        id: newId('offer'),
        release_id: input.release_id,
        territories: [...new Set(input.territories)],
        currency: 'KRW',
        price_minor: input.price_minor,
        vat_rate_bp: input.vat_rate_bp,
        capabilities: ['play'],
        status: 'on_sale',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'offer.created',
      subjectType: 'offer',
      subjectId: offer.id,
      reason: input.reason,
      correlationId,
      details: { release_id: input.release_id, price_minor: input.price_minor },
    });
    return offerView(offer);
  });
}

/** Every offer of a release, newest first, for the operator console. */
export async function releaseOffers(db: DbOrTx, releaseId: string) {
  const rows = await db
    .selectFrom('offer')
    .selectAll()
    .where('release_id', '=', releaseId)
    .orderBy('created_at', 'desc')
    .execute();
  return { items: rows.map(offerView) };
}

/** Withdrawal cancels pending orders; their late payments are refunded (COM-018). */
export async function withdrawOffer(
  db: Db,
  operator: Principal,
  offerId: string,
  reason: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const offer = await tx
      .updateTable('offer')
      .set((eb) => ({
        status: 'withdrawn',
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', offerId)
      .where('status', '=', 'on_sale')
      .returningAll()
      .executeTakeFirst();
    if (!offer) throw errors.notFound();
    const cancelled = await tx
      .updateTable('purchase_order')
      .set((eb) => ({
        status: 'cancelled',
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('offer_id', '=', offerId)
      .where('status', '=', 'pending')
      .returning('id')
      .execute();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'offer.withdrawn',
      subjectType: 'offer',
      subjectId: offerId,
      reason,
      correlationId,
      details: { cancelled_orders: cancelled.length },
    });
    return offerView(offer);
  });
}

/** Order with its provider events, refunds and journals, for support and finance. */
export async function opsOrder(db: DbOrTx, orderId: string) {
  const o = await db
    .selectFrom('purchase_order')
    .selectAll()
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!o) throw errors.notFound();
  const [events, refunds, journals] = await Promise.all([
    o.checkout_ref
      ? db
          .selectFrom('payment_event')
          .select(['id', 'type', 'status', 'detail', 'received_at', 'processed_at'])
          .where('provider', '=', o.provider)
          .where('checkout_ref', '=', o.checkout_ref)
          .orderBy('received_at')
          .execute()
      : [],
    db
      .selectFrom('payment_refund')
      .select(['id', 'status', 'amount_minor', 'requested_by', 'reason', 'created_at'])
      .where('order_id', '=', o.id)
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('ledger_journal as j')
      .innerJoin('ledger_line as l', 'l.journal_id', 'j.id')
      .select(['j.id', 'j.kind', 'l.line_no', 'l.account', 'l.debit_minor', 'l.credit_minor'])
      .where('j.order_id', '=', o.id)
      .orderBy('j.created_at')
      .orderBy('l.line_no')
      .execute(),
  ]);
  return {
    ...orderView(o),
    user_id: o.user_id,
    provider: o.provider,
    events: events.map((e) => ({
      payment_event_id: e.id,
      type: e.type,
      status: e.status,
      detail: e.detail,
      received_at: e.received_at.toISOString(),
      processed_at: e.processed_at?.toISOString() ?? null,
    })),
    refunds: refunds.map((r) => ({
      refund_id: r.id,
      status: r.status,
      amount_minor: r.amount_minor,
      requested_by: r.requested_by,
      reason: r.reason,
      created_at: r.created_at.toISOString(),
    })),
    ledger: journals.map((l) => ({
      journal_id: l.id,
      kind: l.kind,
      line_no: l.line_no,
      account: l.account,
      debit_minor: l.debit_minor,
      credit_minor: l.credit_minor,
    })),
  };
}

// ---- subscription (COM-008, provisional) ----

/** Only KRW is priced so far, so only KR accounts can subscribe (ADR-0018 provisional). */
const SUBSCRIPTION_TERRITORIES = ['KR'];

export async function subscriptionPlan(
  db: Db,
  userId: Principal['userId'],
  plan: PlanConfig,
  checkoutAvailable: boolean,
) {
  const country = (await getUser(db, userId))?.license_country ?? null;
  const sub = await getSubscription(db, userId);
  const pending = await db
    .selectFrom('purchase_order')
    .select('id')
    .where('user_id', '=', userId)
    .where('kind', '=', 'subscription')
    .where('status', '=', 'pending')
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  return {
    plan: plan.plan,
    period: 'P1M',
    price: {
      amount_minor: plan.priceMinor,
      currency: 'KRW',
      tax_minor: includedTax(plan.priceMinor, KR_VAT_BP),
      tax_included: true,
    },
    available: country !== null && SUBSCRIPTION_TERRITORIES.includes(country),
    checkout_available: checkoutAvailable,
    current: sub
      ? {
          state: sub.state,
          paid_through: sub.paid_through.toISOString(),
          auto_renew: sub.auto_renew,
        }
      : null,
    pending_order_id: pending?.id ?? null,
    terms_version: SUBSCRIPTION_TERMS_VERSION,
  };
}

async function insertSubscriptionOrder(
  tx: DbOrTx,
  provider: PaymentProvider,
  input: { userId: string; territory: string; plan: PlanConfig; renewal: boolean },
): Promise<OrderRow> {
  const tax = includedTax(input.plan.priceMinor, KR_VAT_BP);
  const snapshot: SubscriptionSnapshot = {
    kind: 'subscription',
    plan: input.plan.plan,
    period_months: 1,
    renewal: input.renewal,
    territory: input.territory,
    currency: 'KRW',
    amount_minor: input.plan.priceMinor,
    tax_minor: tax,
    vat_rate_bp: KR_VAT_BP,
    capabilities: ['play'],
    terms_version: SUBSCRIPTION_TERMS_VERSION,
  };
  const orderId = newId('order');
  await tx
    .insertInto('purchase_order')
    .values({
      id: orderId,
      user_id: input.userId,
      kind: 'subscription',
      offer_id: null,
      offer_version: null,
      status: 'pending',
      currency: 'KRW',
      amount_minor: input.plan.priceMinor,
      tax_minor: tax,
      snapshot: JSON.stringify(snapshot),
      provider: provider.name,
      checkout_ref: null,
      checkout_url: null,
      entitlement_id: null,
      expires_at: new Date(Date.now() + ORDER_TTL_MS),
      paid_at: null,
      refunded_at: null,
    })
    .execute();
  // A renewal charges the stored payment method; a first payment needs a checkout.
  const payment = input.renewal
    ? {
        ...(await provider.charge(tx, {
          orderId,
          userId: input.userId,
          amountMinor: input.plan.priceMinor,
          currency: 'KRW',
        })),
        checkoutUrl: null,
      }
    : await provider.createCheckout(tx, {
        orderId,
        amountMinor: input.plan.priceMinor,
        currency: 'KRW',
      });
  return tx
    .updateTable('purchase_order')
    .set({ checkout_ref: payment.checkoutRef, checkout_url: payment.checkoutUrl })
    .where('id', '=', orderId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Opens a checkout for one month of the plan. While one is pending it is
 * returned; an active subscription that renews is not sold twice.
 */
export async function createSubscriptionOrder(
  db: Db,
  provider: PaymentProvider,
  principal: Principal,
  plan: PlanConfig,
  correlationId: string,
): Promise<{ status: 200 | 201; body: ReturnType<typeof orderView> }> {
  const result = await db.transaction().execute(async (tx) => {
    const now = new Date();
    const country = (await getUser(tx, principal.userId))?.license_country;
    if (!country || !SUBSCRIPTION_TERRITORIES.includes(country)) {
      throw errors.denied(
        'RIGHTS_UNAVAILABLE',
        'The subscription is not available in your region.',
      );
    }
    const current = await getSubscription(tx, principal.userId);
    if (current?.state === 'active') {
      throw errors.alreadyExists(
        current.auto_renew
          ? 'Your subscription is active and renews automatically.'
          : 'Your subscription is active; turn renewal back on instead of paying again.',
      );
    }
    await tx
      .updateTable('purchase_order')
      .set((eb) => ({ status: 'expired', version: eb('version', '+', 1), updated_at: now }))
      .where('user_id', '=', principal.userId)
      .where('kind', '=', 'subscription')
      .where('status', '=', 'pending')
      .where('expires_at', '<=', now)
      .execute();
    const pending = await tx
      .selectFrom('purchase_order')
      .selectAll()
      .where('user_id', '=', principal.userId)
      .where('kind', '=', 'subscription')
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) return { status: 200 as const, order: pending };
    const order = await insertSubscriptionOrder(tx, provider, {
      userId: principal.userId,
      territory: country,
      plan,
      renewal: false,
    });
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'order.created',
      subjectType: 'order',
      subjectId: order.id,
      correlationId,
      details: { kind: 'subscription', plan: plan.plan, amount_minor: plan.priceMinor },
    });
    return { status: 201 as const, order };
  });
  if (result.status === 201) metrics.orders.inc({ event: 'created' });
  return { status: result.status, body: orderView(result.order) };
}

/** Stops renewal; the paid period stays (COM-008). Purchases are untouched (COM-009). */
export async function cancelSubscriptionRenewal(
  db: Db,
  principal: Principal,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const view = await stopSubscriptionRenewal(tx, principal.userId);
    if (!view.subscription) throw errors.notFound();
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'subscription.renewal_stopped',
      subjectType: 'subscription',
      subjectId: view.subscription.subscription_id,
      correlationId,
    });
    return view;
  });
}

/** Turns renewal back on while the paid month is still running. */
export async function resumeRenewal(db: Db, principal: Principal, correlationId: string) {
  return db.transaction().execute(async (tx) => {
    const view = await resumeSubscriptionRenewal(tx, principal.userId);
    if (!view?.subscription) throw errors.invalidState('Only an active subscription can renew.');
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'subscription.renewal_resumed',
      subjectType: 'subscription',
      subjectId: view.subscription.subscription_id,
      correlationId,
    });
    return view;
  });
}

/**
 * Scheduled: charges subscriptions that renew and end within a day. A declined
 * charge makes the subscription past due (no access) until the user pays again.
 */
export async function renewSubscriptions(
  db: Db,
  provider: PaymentProvider,
  plan: PlanConfig,
  log: Logger,
  now = new Date(),
): Promise<number> {
  const due = await db
    .selectFrom('subscription as s')
    .innerJoin('app_user as u', 'u.id', 's.user_id')
    .select(['s.user_id', 'u.license_country'])
    .where('s.state', '=', 'active')
    .where('s.auto_renew', '=', true)
    .where('s.paid_through', '<=', new Date(now.getTime() + RENEW_AHEAD_MS))
    .where('u.status', '=', 'active')
    .limit(500)
    .execute();
  let started = 0;
  for (const d of due) {
    const territory = d.license_country;
    if (!territory || !SUBSCRIPTION_TERRITORIES.includes(territory)) {
      log.warn({ user_id: d.user_id }, 'subscription renewal skipped: no subscription territory');
      continue;
    }
    const created = await db.transaction().execute(async (tx) => {
      const sub = await tx
        .selectFrom('subscription')
        .select(['state', 'auto_renew'])
        .where('user_id', '=', d.user_id)
        .forUpdate()
        .executeTakeFirst();
      if (sub?.state !== 'active' || !sub.auto_renew) return false;
      const open = await tx
        .selectFrom('purchase_order')
        .select('id')
        .where('user_id', '=', d.user_id)
        .where('kind', '=', 'subscription')
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (open) return false;
      await insertSubscriptionOrder(tx, provider, {
        userId: d.user_id,
        territory,
        plan,
        renewal: true,
      });
      return true;
    });
    if (created) started++;
  }
  if (started > 0) metrics.orders.inc({ event: 'renewal_charged' }, started);
  return started;
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
