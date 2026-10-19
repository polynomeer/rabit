/** Operator side: offers on sale and the order view for support and finance. */
import type { Db, DbOrTx } from '../../platform/db/db.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { offerView, orderView } from './shared.js';

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
