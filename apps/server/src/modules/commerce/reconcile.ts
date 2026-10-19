/** Reconciliation with the payment provider (ADR-0018). */
import type { Db } from '../../platform/db/db.js';
import type { Logger } from '../../platform/logger.js';
import { metrics } from '../../platform/metrics.js';
import type { PaymentProvider } from './provider.js';

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
