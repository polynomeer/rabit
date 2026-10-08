import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DbOrTx } from '../../platform/db/db.js';
import { newId } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import { WebhookRejected, type PaymentProvider, type ProviderEvent } from './provider.js';

export const MOCK_SIGNATURE_HEADER = 'mock-pay-signature';
/** Job that delivers a signed mock webhook, as the provider would over HTTP. */
export const MOCK_DELIVER_JOB = 'mockpay.deliver';
const TOLERANCE_S = 300;

const bodySchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed']),
  data: z.object({
    checkout_ref: z.string().min(1).max(100),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    refund_ref: z.string().min(1).max(100).optional(),
  }),
});
export type MockWebhookBody = z.infer<typeof bodySchema>;

/**
 * Sandbox provider (ADR-0018, provisional). Its "hosted page" is the dev
 * endpoints under /dev/mock-pay; outcomes come back as HMAC-signed webhooks
 * through the same verification path a real provider would use. Never enabled
 * in production (config).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(
    private readonly secret: string,
    private readonly apiBaseUrl: string,
    private readonly now: () => number = Date.now,
  ) {}

  async createCheckout(
    db: DbOrTx,
    order: { orderId: string; amountMinor: number; currency: string },
  ) {
    const checkoutRef = `mck_${randomBytes(12).toString('hex')}`;
    await db
      .insertInto('mock_payment')
      .values({
        id: newId('mockPayment'),
        checkout_ref: checkoutRef,
        order_id: order.orderId,
        amount_minor: order.amountMinor,
        currency: order.currency,
        status: 'open',
      })
      .execute();
    return { checkoutRef, checkoutUrl: `${this.apiBaseUrl}/dev/mock-pay/checkouts/${checkoutRef}` };
  }

  async requestRefund(
    db: DbOrTx,
    input: { refundId: string; checkoutRef: string; amountMinor: number },
  ) {
    const providerRef = `mrf_${input.refundId}`;
    const p = await db
      .updateTable('mock_payment')
      .set({ status: 'refunded', updated_at: new Date() })
      .where('checkout_ref', '=', input.checkoutRef)
      .where('status', '=', 'succeeded')
      .returning(['amount_minor', 'currency'])
      .executeTakeFirst();
    await this.deliverLater(db, {
      id: `evt_${providerRef}`,
      type: p ? 'refund.succeeded' : 'refund.failed',
      data: {
        checkout_ref: input.checkoutRef,
        amount_minor: input.amountMinor,
        currency: p?.currency ?? 'KRW',
        refund_ref: providerRef,
      },
    });
    return { providerRef };
  }

  /** The buyer finishing (or failing) payment on the mock hosted page. */
  async complete(db: DbOrTx, checkoutRef: string, outcome: 'succeeded' | 'failed') {
    const p = await db
      .updateTable('mock_payment')
      .set({ status: outcome, updated_at: new Date() })
      .where('checkout_ref', '=', checkoutRef)
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst();
    if (!p) return false;
    await this.deliverLater(db, {
      id: `evt_${p.id}_${outcome}`,
      type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      data: { checkout_ref: checkoutRef, amount_minor: p.amount_minor, currency: p.currency },
    });
    return true;
  }

  async checkout(db: DbOrTx, checkoutRef: string) {
    return db
      .selectFrom('mock_payment')
      .select(['checkout_ref', 'order_id', 'amount_minor', 'currency', 'status'])
      .where('checkout_ref', '=', checkoutRef)
      .executeTakeFirst();
  }

  /** Signature header value for a raw body (also used by tests to forge or replay). */
  sign(rawBody: string, timestampS = Math.floor(this.now() / 1000)): string {
    const mac = createHmac('sha256', this.secret).update(`${timestampS}.${rawBody}`).digest('hex');
    return `t=${timestampS},v1=${mac}`;
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent {
    const header = headers[MOCK_SIGNATURE_HEADER];
    if (typeof header !== 'string') throw new WebhookRejected('signature');
    const parts = new Map(
      header.split(',').map((kv) => {
        const [k = '', v = ''] = kv.split('=', 2);
        return [k, v] as const;
      }),
    );
    const t = Number(parts.get('t'));
    const v1 = parts.get('v1') ?? '';
    if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) throw new WebhookRejected('signature');
    const expected = this.sign(rawBody, t).split('v1=')[1] ?? '';
    const a = Buffer.from(v1, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookRejected('signature');
    if (Math.abs(this.now() / 1000 - t) > TOLERANCE_S) throw new WebhookRejected('timestamp');
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WebhookRejected('payload');
    }
    const body = bodySchema.safeParse(json);
    if (!body.success) throw new WebhookRejected('payload');
    return {
      eventId: body.data.id,
      type: body.data.type,
      checkoutRef: body.data.data.checkout_ref,
      amountMinor: body.data.data.amount_minor,
      currency: body.data.data.currency,
      refundRef: body.data.data.refund_ref,
    };
  }

  async lookup(db: DbOrTx, checkoutRef: string) {
    const p = await this.checkout(db, checkoutRef);
    return p
      ? {
          state: p.status,
          amountMinor: p.amount_minor,
          currency: p.currency,
        }
      : null;
  }

  private async deliverLater(db: DbOrTx, body: MockWebhookBody) {
    await enqueue(db, {
      kind: MOCK_DELIVER_JOB,
      payload: { body: JSON.stringify(body) },
      dedupeKey: `${MOCK_DELIVER_JOB}:${body.id}`,
    });
  }
}
