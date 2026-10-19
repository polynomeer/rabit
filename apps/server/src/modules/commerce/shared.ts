/** Shared by the commerce files: row views, purchase terms and the sellability checks. */
import { type Selectable } from 'kysely';
import type { DbOrTx } from '../../platform/db/db.js';
import type {
  OfferTable,
  OrderStatus,
  PurchaseOrderTable,
  ReleaseSnapshot,
} from '../../platform/db/schema.js';
import { activeGrants } from '../catalog/index.js';
import { includedTax } from './ledger.js';

export type OfferRow = Selectable<OfferTable>;
export type OrderRow = Selectable<PurchaseOrderTable>;

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

export async function releaseTracks(db: DbOrTx, releaseId: string) {
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
export async function releaseStillSellable(
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
export async function sellable(db: DbOrTx, recordingIds: string[], territory: string, now: Date) {
  if (recordingIds.length === 0) return false;
  const grants = await activeGrants(db, recordingIds, territory, 'stream', now);
  return recordingIds.every((id) => grants.has(id));
}

export async function ownsRelease(db: DbOrTx, userId: string, releaseId: string) {
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

export async function setStatus(
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
