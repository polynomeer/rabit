/** Full refunds through the provider that took the payment. */
import type { Db, DbOrTx } from '../../platform/db/db.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import type { PaymentProvider } from './provider.js';
import { type OrderRow, SUBMIT_REFUND_JOB, orderView, setStatus } from './shared.js';

/** Records a full refund request; the provider is called by a job after commit. */
export async function startRefund(
  tx: DbOrTx,
  order: OrderRow,
  requestedBy: string,
  reason: string,
) {
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
  providerName: string | null,
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
    // Each order is refunded through the provider that took the money. App Store
    // purchases are refunded by Apple only; its REFUND notification then applies.
    if (o.provider === 'app_store') {
      throw errors.invalidState(
        'App Store purchases are refunded by Apple. The customer requests it at reportaproblem.apple.com.',
      );
    }
    if (o.provider !== providerName) {
      throw errors.invalidState(`Orders paid through ${o.provider} cannot be refunded here.`);
    }
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
      .select([
        'r.id',
        'r.status',
        'r.provider_ref',
        'r.amount_minor',
        'o.checkout_ref',
        'o.provider',
      ])
      .where('r.id', '=', refundId)
      .forUpdate()
      .executeTakeFirst();
    if (!r || r.status !== 'requested' || r.provider_ref || !r.checkout_ref) return;
    // Never send a refund to a provider that did not take the payment.
    if (r.provider !== provider.name) return;
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
