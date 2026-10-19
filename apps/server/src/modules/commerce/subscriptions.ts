/** The monthly subscription through the web provider (COM-008, provisional). */
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { SubscriptionSnapshot } from '../../platform/db/schema.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import type { Logger } from '../../platform/logger.js';
import { metrics } from '../../platform/metrics.js';
import {
  getSubscription,
  resumeSubscriptionRenewal,
  stopSubscriptionRenewal,
} from '../entitlement/index.js';
import { getUser } from '../identity/index.js';
import { includedTax } from './ledger.js';
import type { PaymentProvider } from './provider.js';
import {
  KR_VAT_BP,
  ORDER_TTL_MS,
  type OrderRow,
  type PlanConfig,
  RENEW_AHEAD_MS,
  SUBSCRIPTION_TERMS_VERSION,
  orderView,
} from './shared.js';

// ---- subscription (COM-008, provisional) ----

/** Only KRW is priced so far, so only KR accounts can subscribe (ADR-0018 provisional). */
export const SUBSCRIPTION_TERRITORIES = ['KR'];

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

export async function insertSubscriptionOrder(
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
    if (current?.source === 'app_store' && ['active', 'past_due'].includes(current.state)) {
      throw errors.alreadyExists('Your subscription is billed by the App Store; manage it there.');
    }
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
    const current = await getSubscription(tx, principal.userId);
    if (current?.source === 'app_store') {
      throw errors.invalidState(
        'This subscription is billed by the App Store; stop renewal there.',
      );
    }
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
    // App Store subscriptions are billed by Apple (ADR-0024).
    .where('s.source', '=', 'sandbox')
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
