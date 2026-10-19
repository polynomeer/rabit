/** Payment provider events: stored, then applied once (COM-004..006). */
import { createHash } from 'node:crypto';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import { audit } from '../../platform/audit.js';
import { newId } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import type { Logger } from '../../platform/logger.js';
import { metrics } from '../../platform/metrics.js';
import {
  activateSubscriptionPeriod,
  endSubscriptionNow,
  issuePurchaseEntitlement,
  markSubscriptionPastDue,
  revokePurchaseEntitlement,
} from '../entitlement/index.js';
import { postRefund, postSale } from './ledger.js';
import type { PaymentProvider, ProviderEvent } from './provider.js';
import { APPLY_EVENT_JOB, type OrderRow, releaseStillSellable, setStatus } from './shared.js';
import { startRefund } from './refunds.js';

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

export type Applied = { status: 'applied' | 'ignored' | 'held'; detail: string };

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

export async function applyToOrder(
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
