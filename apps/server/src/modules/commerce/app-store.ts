import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { audit } from '../../platform/audit.js';
import type { AppStoreConfig } from '../../platform/config.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { Principal } from '../../platform/http/principal.js';
import { errors } from '../../platform/errors.js';
import { newId } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import type { Logger } from '../../platform/logger.js';
import { metrics } from '../../platform/metrics.js';
import { getUser } from '../identity/index.js';
import {
  activateStorePeriod,
  endSubscriptionNow,
  expireStoreSubscription,
  getSubscription,
  markSubscriptionPastDue,
  setStoreRenewal,
  subscriptionView,
} from '../entitlement/index.js';
import { includedTax, postRefund, postSale } from './ledger.js';

/**
 * The Listen subscription as an App Store in-app purchase (ADR-0024). Apple charges;
 * we verify Apple's signed transactions and notifications and apply them to the same
 * orders, ledger, subscription and entitlement as the web subscription.
 */

export const APP_STORE = 'app_store';
export const APPLY_STORE_EVENT_JOB = 'commerce.apply_app_store_event';
const KR_VAT_BP = 1_000;
const TERRITORIES = ['KR'];
const PLAN = 'listen_monthly';

/** Marks Sandbox ids on a Production server, so they never meet real ones. */
const TEST_PREFIX = 'sandbox:';

/** What we use of a verified transaction. */
export interface StoreTransaction {
  /** Prefixed with `sandbox:` for a test purchase (see `test`). */
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  appAccountToken: string | null;
  expiresAt: Date | null;
  revoked: boolean;
  /** Customer price in currency units × 1000 (Apple's milliunits), when Apple sends it. */
  priceMilli: number | null;
  currency: string | null;
  /**
   * A Sandbox purchase on a Production server (App Review, TestFlight): it grants
   * access but is not a sale (ADR-0024 amendment).
   */
  test: boolean;
}

/** What we use of a verified App Store Server Notification V2. */
export interface StoreNotification {
  notificationUUID: string;
  type: string;
  subtype: string | null;
  transaction: StoreTransaction | null;
  autoRenew: boolean | null;
  originalTransactionId: string | null;
  /** Sandbox data on a Production server (see `StoreTransaction.test`). */
  test: boolean;
}

export class StoreRejected extends Error {
  constructor(readonly reason: string) {
    super(`App Store data rejected: ${reason}`);
    this.name = 'StoreRejected';
  }
}

/** Verifies Apple's JWS with the App Store Server Library. */
export class AppStoreVerifier {
  private readonly verifier: SignedDataVerifier;
  /** Production with `acceptSandbox`: the fallback for Sandbox-signed data. */
  private readonly sandbox: SignedDataVerifier | null;

  /** `verifiers` replaces Apple's verifiers in tests (signed data needs Apple's chain). */
  constructor(
    readonly config: AppStoreConfig,
    verifiers?: { primary: SignedDataVerifier; sandbox: SignedDataVerifier | null },
  ) {
    if (verifiers) {
      this.verifier = verifiers.primary;
      this.sandbox = verifiers.sandbox;
      return;
    }
    const env = {
      Production: Environment.PRODUCTION,
      Sandbox: Environment.SANDBOX,
      Xcode: Environment.XCODE,
      LocalTesting: Environment.LOCAL_TESTING,
    }[config.environment];
    const roots = config.rootCertPaths.map((p) => readFileSync(p));
    const signed = config.environment === 'Production' || config.environment === 'Sandbox';
    this.verifier = new SignedDataVerifier(roots, signed, env, config.bundleId, config.appAppleId);
    this.sandbox =
      config.environment === 'Production' && config.acceptSandbox
        ? new SignedDataVerifier(roots, true, Environment.SANDBOX, config.bundleId)
        : null;
  }

  /**
   * Runs `f` with the configured verifier; on Production with `acceptSandbox`, data
   * signed for Sandbox is verified again as Sandbox and marked as a test.
   */
  private async verified<T>(
    f: (v: SignedDataVerifier) => Promise<T>,
  ): Promise<{ value: T; test: boolean; verifier: SignedDataVerifier }> {
    try {
      return { value: await f(this.verifier), test: false, verifier: this.verifier };
    } catch (err) {
      const otherEnvironment =
        err instanceof VerificationException &&
        err.status === VerificationStatus.INVALID_ENVIRONMENT;
      if (!this.sandbox || !otherEnvironment) throw err;
      return { value: await f(this.sandbox), test: true, verifier: this.sandbox };
    }
  }

  async transaction(jws: string): Promise<StoreTransaction> {
    try {
      const r = await this.verified((v) => v.verifyAndDecodeTransaction(jws));
      return toTransaction(r.value, r.test);
    } catch (err) {
      throw rejected(err);
    }
  }

  async notification(signedPayload: string): Promise<StoreNotification> {
    try {
      const r = await this.verified((v) => v.verifyAndDecodeNotification(signedPayload));
      const { value: n, test, verifier } = r;
      const data = n.data;
      const transaction = data?.signedTransactionInfo
        ? toTransaction(await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo), test)
        : null;
      const renewal = data?.signedRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo)
        : null;
      if (!n.notificationUUID || !n.notificationType) throw new StoreRejected('payload');
      const original = renewal?.originalTransactionId;
      return {
        notificationUUID: n.notificationUUID,
        type: n.notificationType,
        subtype: n.subtype ?? null,
        transaction,
        autoRenew: renewal?.autoRenewStatus === undefined ? null : renewal.autoRenewStatus === 1,
        originalTransactionId:
          transaction?.originalTransactionId ?? (original ? marked(original, test) : null),
        test,
      };
    } catch (err) {
      throw rejected(err);
    }
  }
}

function rejected(err: unknown): StoreRejected {
  if (err instanceof StoreRejected) return err;
  if (err instanceof VerificationException)
    return new StoreRejected(`status_${String(err.status)}`);
  return new StoreRejected('payload');
}

const marked = (id: string, test: boolean) => (test ? `${TEST_PREFIX}${id}` : id);

function toTransaction(t: JWSTransactionDecodedPayload, test: boolean): StoreTransaction {
  if (!t.transactionId || !t.originalTransactionId || !t.productId)
    throw new StoreRejected('payload');
  return {
    transactionId: marked(t.transactionId, test),
    originalTransactionId: marked(t.originalTransactionId, test),
    productId: t.productId,
    appAccountToken: t.appAccountToken ?? null,
    expiresAt: t.expiresDate ? new Date(t.expiresDate) : null,
    revoked: t.revocationDate !== undefined,
    priceMilli: typeof t.price === 'number' ? t.price : null,
    currency: t.currency ?? null,
    test,
  };
}

// ---- account link ----

/** The caller's `appAccountToken`, created on first use (ADR-0024). */
export async function appAccountToken(db: DbOrTx, userId: string): Promise<string> {
  await db
    .insertInto('app_store_account')
    .values({ user_id: userId, app_account_token: randomUUID() })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  const row = await db
    .selectFrom('app_store_account')
    .select('app_account_token')
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  return row.app_account_token;
}

/** What the app needs before offering the purchase: one subscription per account. */
export async function appStoreStatus(db: Db, userId: Principal['userId'], cfg: AppStoreConfig) {
  const token = await appAccountToken(db, userId);
  const country = (await getUser(db, userId))?.license_country ?? null;
  const sub = await getSubscription(db, userId);
  const elsewhere =
    sub !== undefined &&
    sub.source !== APP_STORE &&
    ['active', 'past_due'].includes(sub.state) &&
    sub.paid_through > new Date();
  const reason =
    country === null || !TERRITORIES.includes(country)
      ? 'region'
      : elsewhere
        ? 'subscribed_elsewhere'
        : null;
  return {
    product_id: cfg.productId,
    app_account_token: token,
    available: reason === null,
    unavailable_reason: reason,
    ...subscriptionView(sub),
  };
}

// ---- applying ----

type OrderTx = DbOrTx;

/**
 * One App Store period, idempotent per Apple transaction: order, sale journal,
 * subscription and entitlement in the caller's transaction.
 */
async function applyPeriod(
  tx: OrderTx,
  userId: string,
  t: StoreTransaction,
  correlationId: string,
): Promise<'applied' | 'duplicate'> {
  const existing = await tx
    .selectFrom('purchase_order')
    .select('id')
    .where('provider', '=', APP_STORE)
    .where('checkout_ref', '=', t.transactionId)
    .executeTakeFirst();
  if (existing) return 'duplicate';
  if (!t.expiresAt) throw new StoreRejected('no_expiry');
  if (t.currency !== null && t.currency !== 'KRW') throw new StoreRejected('currency');
  const amount = t.priceMilli !== null ? Math.round(t.priceMilli / 1000) : null;
  if (amount === null || amount <= 0) throw new StoreRejected('price');
  const tax = includedTax(amount, KR_VAT_BP);
  const { entitlementId, overlap } = await activateStorePeriod(
    tx,
    { userId, plan: PLAN, expiresAt: t.expiresAt, originalTransactionId: t.originalTransactionId },
    correlationId,
  );
  const now = new Date();
  const order = await tx
    .insertInto('purchase_order')
    .values({
      id: newId('order'),
      user_id: userId,
      kind: 'subscription',
      offer_id: null,
      offer_version: null,
      status: 'fulfilled',
      currency: 'KRW',
      amount_minor: amount,
      tax_minor: tax,
      snapshot: JSON.stringify({
        kind: 'subscription',
        plan: PLAN,
        period_months: 1,
        renewal: t.transactionId !== t.originalTransactionId,
        territory: 'KR',
        currency: 'KRW',
        amount_minor: amount,
        tax_minor: tax,
        vat_rate_bp: KR_VAT_BP,
        capabilities: ['play'],
        terms_version: 'app-store',
        ...(t.test ? { test: true } : {}),
        store: {
          transaction_id: t.transactionId,
          original_transaction_id: t.originalTransactionId,
        },
      }),
      provider: APP_STORE,
      checkout_ref: t.transactionId,
      checkout_url: null,
      entitlement_id: entitlementId,
      expires_at: now,
      paid_at: now,
      refunded_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  // A test purchase was never paid: access, but no sale in the ledger.
  if (!t.test) await postSale(tx, order);
  await audit(tx, {
    actorType: 'system',
    actorId: null,
    action: 'order.fulfilled',
    subjectType: 'order',
    subjectId: order.id,
    correlationId,
    details: { provider: APP_STORE, entitlement_id: entitlementId, overlap, test: t.test },
  });
  metrics.orders.inc({ event: t.test ? 'fulfilled_test' : 'fulfilled' });
  if (overlap) {
    metrics.appStoreOverlaps.inc();
    await audit(tx, {
      actorType: 'system',
      actorId: null,
      action: 'subscription.overlap',
      subjectType: 'user',
      subjectId: userId,
      correlationId,
      details: { order_id: order.id, note: 'web subscription was active; refund one side' },
    });
  }
  return 'applied';
}

/** Refund or revocation: the sale reversed, access ends now (ADR-0024). */
async function applyRefund(
  tx: OrderTx,
  userId: string,
  t: StoreTransaction,
  correlationId: string,
): Promise<'applied' | 'ignored' | 'held'> {
  const order = await tx
    .selectFrom('purchase_order')
    .selectAll()
    .where('provider', '=', APP_STORE)
    .where('checkout_ref', '=', t.transactionId)
    .forUpdate()
    .executeTakeFirst();
  if (!order) return 'held';
  if (order.status === 'refunded') return 'ignored';
  if (!t.test) await postRefund(tx, order);
  await tx
    .updateTable('purchase_order')
    .set((eb) => ({
      status: 'refunded',
      refunded_at: new Date(),
      version: eb('version', '+', 1),
      updated_at: new Date(),
    }))
    .where('id', '=', order.id)
    .execute();
  await endSubscriptionNow(tx, userId, correlationId);
  await audit(tx, {
    actorType: 'system',
    actorId: null,
    action: 'order.refunded',
    subjectType: 'order',
    subjectId: order.id,
    correlationId,
    details: { provider: APP_STORE, test: t.test },
  });
  metrics.orders.inc({ event: t.test ? 'refunded_test' : 'refunded' });
  return 'applied';
}

/** The account a transaction belongs to: its token, or the original transaction's link. */
async function ownerOf(
  tx: DbOrTx,
  t: { appAccountToken: string | null; originalTransactionId: string | null },
) {
  if (t.appAccountToken) {
    const row = await tx
      .selectFrom('app_store_account')
      .select('user_id')
      .where('app_account_token', '=', t.appAccountToken.toLowerCase())
      .executeTakeFirst();
    if (row) return row.user_id;
  }
  if (t.originalTransactionId) {
    const sub = await tx
      .selectFrom('subscription')
      .select('user_id')
      .where('store_original_transaction_id', '=', t.originalTransactionId)
      .executeTakeFirst();
    if (sub) return sub.user_id;
  }
  return null;
}

/**
 * A transaction the app sends after a purchase, renewal or restore. Accepted only for
 * our product, the caller's account token, and an original transaction not bound to
 * another account.
 */
export async function submitTransaction(
  db: Db,
  verifier: AppStoreVerifier,
  principal: Principal,
  jws: string,
  correlationId: string,
) {
  let t: StoreTransaction;
  try {
    t = await verifier.transaction(jws);
  } catch (err) {
    if (err instanceof StoreRejected) {
      metrics.paymentEvents.inc({
        provider: APP_STORE,
        type: 'transaction',
        outcome: `rejected_${err.reason}`,
      });
      throw errors.unprocessable(
        'UNPROCESSABLE',
        'The App Store transaction could not be verified.',
      );
    }
    throw err;
  }
  if (t.productId !== verifier.config.productId) {
    throw errors.unprocessable('UNPROCESSABLE', 'This App Store product is not sold here.');
  }
  return db.transaction().execute(async (tx) => {
    const token = await appAccountToken(tx, principal.userId);
    if (!t.appAccountToken || t.appAccountToken.toLowerCase() !== token) {
      throw errors.forbidden('This App Store purchase belongs to another account.');
    }
    const bound = await tx
      .selectFrom('subscription')
      .select('user_id')
      .where('store_original_transaction_id', '=', t.originalTransactionId)
      .executeTakeFirst();
    if (bound && bound.user_id !== principal.userId) {
      throw errors.alreadyExists('This App Store subscription is linked to another account.');
    }
    try {
      if (t.revoked) await applyRefund(tx, principal.userId, t, correlationId);
      else await applyPeriod(tx, principal.userId, t, correlationId);
    } catch (err) {
      if (err instanceof StoreRejected) {
        throw errors.unprocessable('UNPROCESSABLE', 'The App Store transaction cannot be applied.');
      }
      throw err;
    }
    metrics.paymentEvents.inc({
      provider: APP_STORE,
      type: 'transaction',
      outcome: t.test ? 'applied_test' : 'applied',
    });
    return subscriptionView(await getSubscription(tx, principal.userId));
  });
}

// ---- server notifications ----

/** Stores a verified notification and queues it (redeliveries are duplicates). */
export async function receiveNotification(
  db: Db,
  verifier: AppStoreVerifier,
  rawBody: string,
): Promise<'received' | 'duplicate'> {
  let signedPayload: unknown;
  try {
    signedPayload = (JSON.parse(rawBody) as { signedPayload?: unknown }).signedPayload;
  } catch {
    signedPayload = undefined;
  }
  if (typeof signedPayload !== 'string') throw new StoreRejected('payload');
  const n = await verifier.notification(signedPayload);
  const outcome = await db.transaction().execute(async (tx) => {
    const id = newId('paymentEvent');
    const inserted = await tx
      .insertInto('payment_event')
      .values({
        id,
        provider: APP_STORE,
        provider_event_id: n.notificationUUID,
        type: n.subtype ? `${n.type}.${n.subtype}` : n.type,
        checkout_ref: n.transaction?.transactionId ?? n.originalTransactionId ?? 'none',
        payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
        payload: JSON.stringify(n),
        status: 'received',
        detail: null,
        processed_at: null,
      })
      .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return 'duplicate' as const;
    await enqueue(tx, {
      kind: APPLY_STORE_EVENT_JOB,
      payload: { payment_event_id: id },
      dedupeKey: `${APPLY_STORE_EVENT_JOB}:${id}`,
    });
    return 'received' as const;
  });
  metrics.paymentEvents.inc({ provider: APP_STORE, type: n.type, outcome });
  return outcome;
}

type Applied = { status: 'applied' | 'ignored' | 'held'; detail: string };

/** Applies one stored notification in a single transaction. */
export async function applyNotification(
  db: Db,
  log: Logger,
  paymentEventId: string,
  productId: string,
) {
  const result = await db.transaction().execute(async (tx) => {
    const ev = await tx
      .selectFrom('payment_event')
      .selectAll()
      .where('id', '=', paymentEventId)
      .forUpdate()
      .executeTakeFirst();
    if (!ev || ev.status !== 'received' || ev.provider !== APP_STORE) return null;
    const n = deserialize(ev.payload as unknown as StoredNotification);
    const r = await applyOne(tx, n, productId, ev.id);
    await tx
      .updateTable('payment_event')
      .set({ status: r.status, detail: r.detail, processed_at: new Date() })
      .where('id', '=', ev.id)
      .execute();
    return { ...r, type: n.type };
  });
  if (!result) return null;
  metrics.paymentEvents.inc({ provider: APP_STORE, type: result.type, outcome: result.status });
  if (result.status === 'held') {
    log.warn(
      { payment_event_id: paymentEventId, detail: result.detail },
      'App Store notification held for review',
    );
  }
  return result;
}

/** A notification as stored; events stored before test purchases existed have no `test`. */
type StoredNotification = Omit<StoreNotification, 'test' | 'transaction'> & {
  test?: boolean;
  transaction: (Omit<StoreTransaction, 'test'> & { test?: boolean }) | null;
};

/** Dates come back from jsonb as strings. */
function deserialize(n: StoredNotification): StoreNotification {
  const t = n.transaction;
  return {
    ...n,
    test: n.test ?? false,
    transaction: t
      ? { ...t, expiresAt: t.expiresAt ? new Date(t.expiresAt) : null, test: t.test ?? false }
      : null,
  };
}

const HANDLED = new Set([
  'SUBSCRIBED',
  'DID_RENEW',
  'DID_CHANGE_RENEWAL_STATUS',
  'DID_FAIL_TO_RENEW',
  'EXPIRED',
  'GRACE_PERIOD_EXPIRED',
  'REFUND',
  'REVOKE',
]);

async function applyOne(
  tx: DbOrTx,
  n: StoreNotification,
  productId: string,
  eventId: string,
): Promise<Applied> {
  // Other types (TEST, CONSUMPTION_REQUEST, PRICE_INCREASE, ...) are acknowledged and
  // ignored before looking for an account: most carry no transaction.
  if (!HANDLED.has(n.type)) return { status: 'ignored', detail: 'not_handled' };
  const t = n.transaction;
  if (t && t.productId !== productId) return { status: 'ignored', detail: 'other_product' };
  const userId = await ownerOf(tx, {
    appAccountToken: t?.appAccountToken ?? null,
    originalTransactionId: n.originalTransactionId,
  });
  if (!userId) return { status: 'held', detail: 'unknown_account' };
  switch (n.type) {
    case 'SUBSCRIBED':
    case 'DID_RENEW': {
      if (!t) return { status: 'held', detail: 'no_transaction' };
      try {
        const r = await applyPeriod(tx, userId, t, eventId);
        return { status: r === 'applied' ? 'applied' : 'ignored', detail: r };
      } catch (err) {
        if (err instanceof StoreRejected) return { status: 'held', detail: err.reason };
        throw err;
      }
    }
    case 'DID_CHANGE_RENEWAL_STATUS': {
      if (n.autoRenew === null) return { status: 'ignored', detail: 'no_renewal_info' };
      const sub = await setStoreRenewal(tx, userId, n.autoRenew);
      return {
        status: sub ? 'applied' : 'ignored',
        detail: n.autoRenew ? 'renewal_on' : 'renewal_off',
      };
    }
    case 'DID_FAIL_TO_RENEW': {
      // With a billing grace period Apple keeps access; without one, no access until paid.
      if (n.subtype === 'GRACE_PERIOD') return { status: 'ignored', detail: 'grace_period' };
      await markSubscriptionPastDue(tx, userId, eventId);
      return { status: 'applied', detail: 'past_due' };
    }
    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED': {
      const changed = await expireStoreSubscription(tx, userId, eventId);
      return { status: changed ? 'applied' : 'ignored', detail: 'expired' };
    }
    case 'REFUND':
    case 'REVOKE': {
      if (!t) return { status: 'held', detail: 'no_transaction' };
      const r = await applyRefund(tx, userId, t, eventId);
      return { status: r, detail: r === 'held' ? 'unknown_order' : 'refunded' };
    }
    default:
      return { status: 'ignored', detail: 'not_handled' };
  }
}
