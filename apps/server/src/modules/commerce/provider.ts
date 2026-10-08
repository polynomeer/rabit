import type { DbOrTx } from '../../platform/db/db.js';

/** What a provider tells us, after its signature was verified (ADR-0018). */
export interface ProviderEvent {
  /** The provider's own event id: the replay key. */
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';
  checkoutRef: string;
  amountMinor: number;
  currency: string;
  /** Set on refund events: the provider's refund reference. */
  refundRef?: string | undefined;
}

export type ProviderPaymentState = 'open' | 'succeeded' | 'failed' | 'refunded';

export class WebhookRejected extends Error {
  constructor(readonly reason: 'signature' | 'timestamp' | 'payload') {
    super(`webhook rejected: ${reason}`);
    this.name = 'WebhookRejected';
  }
}

/**
 * Provider-agnostic port (ADR-0018). A real provider replaces the mock without
 * changes to orders, the ledger or entitlements. Methods that write take the
 * caller's transaction so the provider record and our state commit together.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Opens a checkout for an order; the buyer pays at `checkoutUrl`. */
  createCheckout(
    db: DbOrTx,
    order: { orderId: string; amountMinor: number; currency: string },
  ): Promise<{ checkoutRef: string; checkoutUrl: string }>;
  /**
   * Charges the buyer's stored payment method (subscription renewal) without a
   * checkout; the outcome arrives later as a webhook. Returns the payment reference.
   */
  charge(
    db: DbOrTx,
    input: { orderId: string; userId: string; amountMinor: number; currency: string },
  ): Promise<{ checkoutRef: string }>;
  /** Asks for a full refund; the outcome arrives later as a webhook. */
  requestRefund(
    db: DbOrTx,
    input: { refundId: string; checkoutRef: string; amountMinor: number },
  ): Promise<{ providerRef: string }>;
  /** Verifies signature and timestamp; throws {@link WebhookRejected}. */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent;
  /** The provider's view of a payment, for reconciliation. */
  lookup(
    db: DbOrTx,
    checkoutRef: string,
  ): Promise<{ state: ProviderPaymentState; amountMinor: number; currency: string } | null>;
}
