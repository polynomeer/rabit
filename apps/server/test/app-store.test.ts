import { randomUUID } from 'node:crypto';
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORE_RENEWAL_MARGIN_MS } from '../src/modules/entitlement/index.js';
import { expireEntitlements } from '../src/modules/entitlement/service.js';
import {
  AppStoreVerifier,
  receiveNotification,
  submitTransaction,
} from '../src/modules/commerce/app-store.js';
import { loadConfig } from '../src/platform/config.js';
import { newId } from '../src/platform/ids.js';
import type { Principal } from '../src/platform/http/principal.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/**
 * The Listen subscription as an App Store in-app purchase (ADR-0024). Tests run the
 * App Store Server Library in `LocalTesting` mode: JWS are not signed (as with
 * StoreKit testing in Xcode), but bundle id, environment and payload shape are checked.
 */

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
const PRODUCT = 'app.rabit.ios.listen.monthly';
const DAY = 86_400_000;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
});
afterAll(() => h.close());

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An unsigned JWS, as Xcode's StoreKit testing produces in shape. */
const jws = (payload: unknown) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.c2ln`;

function transaction(o: {
  id: string;
  original?: string;
  token: string;
  expires: number;
  product?: string;
  environment?: string;
  revoked?: boolean;
}) {
  return {
    transactionId: o.id,
    originalTransactionId: o.original ?? o.id,
    bundleId: 'app.rabit.ios',
    productId: o.product ?? PRODUCT,
    purchaseDate: Date.now(),
    originalPurchaseDate: Date.now(),
    expiresDate: o.expires,
    type: 'Auto-Renewable Subscription',
    appAccountToken: o.token,
    inAppOwnershipType: 'PURCHASED',
    signedDate: Date.now(),
    environment: o.environment ?? 'LocalTesting',
    transactionReason: 'PURCHASE',
    storefront: 'KOR',
    price: 10_900_000,
    currency: 'KRW',
    ...(o.revoked ? { revocationDate: Date.now(), revocationReason: 0 } : {}),
  };
}

function notification(
  type: string,
  data: { transaction?: object; autoRenew?: 0 | 1; original?: string },
  subtype?: string,
) {
  return {
    signedPayload: jws({
      notificationType: type,
      ...(subtype ? { subtype } : {}),
      notificationUUID: randomUUID(),
      version: '2.0',
      signedDate: Date.now(),
      data: {
        bundleId: 'app.rabit.ios',
        environment: 'LocalTesting',
        ...(data.transaction ? { signedTransactionInfo: jws(data.transaction) } : {}),
        ...(data.autoRenew !== undefined
          ? {
              signedRenewalInfo: jws({
                originalTransactionId: data.original,
                autoRenewProductId: PRODUCT,
                productId: PRODUCT,
                autoRenewStatus: data.autoRenew,
                signedDate: Date.now(),
                environment: 'LocalTesting',
              }),
            }
          : {}),
      },
    }),
  };
}

async function krUser() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  return u;
}

async function status(u: TestUser) {
  const r = await h.api.inject({ url: '/v1/subscription/app-store', headers: u.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{
    app_account_token: string;
    available: boolean;
    unavailable_reason: string | null;
    subscription: {
      state: string;
      source: string;
      auto_renew: boolean;
      paid_through: string;
    } | null;
  }>();
}

const submit = (u: TestUser, t: object) =>
  h.api.inject({
    method: 'POST',
    url: '/v1/subscription/app-store/transactions',
    headers: u.headers,
    payload: { signed_transaction: jws(t) },
  });

const notify = (body: object) =>
  h.api.inject({
    method: 'POST',
    url: '/webhooks/app-store',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });

const play = (u: TestUser) =>
  h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: cat.ids['r1'], device_id: 'device-test-1' },
  });

async function purchased(u: TestUser, days = 30) {
  const { app_account_token: token } = await status(u);
  const id = `2000000${String(Math.floor(Math.random() * 1e9))}`;
  const r = await submit(u, transaction({ id, token, expires: Date.now() + days * DAY }));
  expect(r.statusCode, r.body).toBe(200);
  return { token, id };
}

describe('App Store subscription (ADR-0024)', () => {
  it('offers the purchase to KR accounts without another subscription', async () => {
    const u = await krUser();
    const s = await status(u);
    expect(s).toMatchObject({ available: true, unavailable_reason: null, subscription: null });
    expect(s.app_account_token).toMatch(/^[0-9a-f-]{36}$/);
    // The token is stable per account.
    expect((await status(u)).app_account_token).toBe(s.app_account_token);

    const jp = await h.user();
    await ops.setCountry(jp, 'JP');
    expect(await status(jp)).toMatchObject({ available: false, unavailable_reason: 'region' });
  });

  it('applies a verified purchase: access, an order and a balanced sale', async () => {
    const u = await krUser();
    expect((await play(u)).statusCode).toBe(403);
    const { id } = await purchased(u);
    const s = await status(u);
    expect(s.subscription).toMatchObject({
      state: 'active',
      source: 'app_store',
      auto_renew: true,
    });
    expect(new Date(s.subscription!.paid_through).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect((await play(u)).statusCode).toBe(201);

    const orders = await h.api.inject({ url: '/v1/orders', headers: u.headers });
    expect(orders.json().items).toEqual([
      expect.objectContaining({
        kind: 'subscription',
        status: 'fulfilled',
        price: expect.objectContaining({ amount_minor: 10_900 }),
      }),
    ]);
    const order = await h.ctx.db
      .selectFrom('purchase_order')
      .select('id')
      .where('checkout_ref', '=', id)
      .executeTakeFirstOrThrow();
    const lines = await h.ctx.db
      .selectFrom('ledger_journal as j')
      .innerJoin('ledger_line as l', 'l.journal_id', 'j.id')
      .select(['l.account', 'l.debit_minor', 'l.credit_minor'])
      .where('j.order_id', '=', order.id)
      .execute();
    expect(lines).toEqual(
      expect.arrayContaining([
        { account: 'app_store_clearing', debit_minor: 10_900, credit_minor: 0 },
        { account: 'revenue', debit_minor: 0, credit_minor: 9_909 },
        { account: 'vat_payable', debit_minor: 0, credit_minor: 991 },
      ]),
    );
  });

  it('applies the same transaction once', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u);
    const again = await submit(u, transaction({ id, token, expires: Date.now() + 30 * DAY }));
    expect(again.statusCode, again.body).toBe(200);
    const n = await h.ctx.db
      .selectFrom('purchase_order')
      .select('id')
      .where('user_id', '=', u.userId)
      .execute();
    expect(n).toHaveLength(1);
  });

  it("never applies another account's purchase, product or environment", async () => {
    const alice = await krUser();
    const bob = await krUser();
    const { app_account_token: aliceToken } = await status(alice);
    const id = `3000000${String(Date.now())}`;
    // Bob sends Alice's purchase (her token inside Apple's signed data).
    const stolen = await submit(
      bob,
      transaction({ id, token: aliceToken, expires: Date.now() + DAY }),
    );
    expect(stolen.statusCode).toBe(403);
    const other = await submit(
      alice,
      transaction({ id, token: aliceToken, expires: Date.now() + DAY, product: 'other.product' }),
    );
    expect(other.statusCode).toBe(422);
    const sandbox = await submit(
      alice,
      transaction({ id, token: aliceToken, expires: Date.now() + DAY, environment: 'Sandbox' }),
    );
    expect(sandbox.statusCode).toBe(422);
    expect((await status(alice)).subscription).toBeNull();

    // An Apple subscription stays bound to the account that first used it.
    await purchased(alice);
    const aliceOriginal = await h.ctx.db
      .selectFrom('subscription')
      .select('store_original_transaction_id')
      .where('user_id', '=', alice.userId)
      .executeTakeFirstOrThrow();
    const { app_account_token: bobToken } = await status(bob);
    const moved = await submit(
      bob,
      transaction({
        id: `${id}9`,
        original: aliceOriginal.store_original_transaction_id!,
        token: bobToken,
        expires: Date.now() + DAY,
      }),
    );
    expect(moved.statusCode).toBe(409);
  });

  it('keeps one subscription per account: the web defers to the App Store and back', async () => {
    const u = await krUser();
    await purchased(u);
    const checkout = await h.api.inject({
      method: 'POST',
      url: '/v1/subscription/checkout',
      headers: { ...u.headers, 'idempotency-key': `app-store-web-${String(Date.now())}` },
      payload: {},
    });
    expect(checkout.statusCode).toBe(409);
    const cancel = await h.api.inject({
      method: 'POST',
      url: '/v1/subscription/cancel',
      headers: u.headers,
    });
    expect(cancel.statusCode).toBe(409);

    // A web subscriber is not offered the in-app purchase.
    const web = await krUser();
    await h.api.inject({
      method: 'PUT',
      url: `/v1/ops/users/${web.userId}/subscription`,
      headers: ops.op.headers,
      payload: {
        plan: 'listen_monthly',
        state: 'active',
        paid_through: new Date(Date.now() + 10 * DAY).toISOString(),
        reason: 'test setup',
      },
    });
    expect(await status(web)).toMatchObject({
      available: false,
      unavailable_reason: 'subscribed_elsewhere',
    });
  });

  it('follows renewals, renewal changes, refunds and expiry from server notifications', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u, 2);

    const renewal = transaction({
      id: `${id}1`,
      original: id,
      token,
      expires: Date.now() + 32 * DAY,
    });
    const renewed = notification('DID_RENEW', { transaction: renewal });
    expect((await notify(renewed)).json()).toEqual({ received: true, duplicate: false });
    expect((await notify(renewed)).json()).toEqual({ received: true, duplicate: true });
    await h.worker.drain();
    expect(new Date((await status(u)).subscription!.paid_through).getTime()).toBeGreaterThan(
      Date.now() + 31 * DAY,
    );

    await notify(
      notification(
        'DID_CHANGE_RENEWAL_STATUS',
        { autoRenew: 0, original: id },
        'AUTO_RENEW_DISABLED',
      ),
    );
    await h.worker.drain();
    expect((await status(u)).subscription).toMatchObject({ state: 'active', auto_renew: false });

    await notify(
      notification('REFUND', {
        transaction: { ...renewal, revocationDate: Date.now(), revocationReason: 0 },
      }),
    );
    await h.worker.drain();
    expect((await status(u)).subscription).toMatchObject({ state: 'cancelled' });
    expect((await play(u)).statusCode).toBe(403);
    const refunded = await h.ctx.db
      .selectFrom('purchase_order')
      .select('status')
      .where('checkout_ref', '=', `${id}1`)
      .executeTakeFirstOrThrow();
    expect(refunded.status).toBe('refunded');

    const v = await krUser();
    const bought = await purchased(v);
    await notify(notification('EXPIRED', { autoRenew: 0, original: bought.id }, 'VOLUNTARY'));
    await h.worker.drain();
    expect((await status(v)).subscription).toMatchObject({ state: 'expired' });
  });

  it('holds notifications for unknown accounts and rejects unverifiable ones', async () => {
    const stranger = transaction({ id: '9999', token: randomUUID(), expires: Date.now() + DAY });
    await notify(notification('SUBSCRIBED', { transaction: stranger }, 'INITIAL_BUY'));
    await h.worker.drain();
    const ev = await h.ctx.db
      .selectFrom('payment_event')
      .select(['status', 'detail'])
      .where('provider', '=', 'app_store')
      .where('checkout_ref', '=', '9999')
      .executeTakeFirstOrThrow();
    expect(ev).toEqual({ status: 'held', detail: 'unknown_account' });

    // App Store Connect's "Request a Test Notification": no transaction, nothing to hold.
    await notify(notification('TEST', {}));
    await h.worker.drain();
    const test = await h.ctx.db
      .selectFrom('payment_event')
      .select(['status', 'detail'])
      .where('provider', '=', 'app_store')
      .where('type', '=', 'TEST')
      .executeTakeFirstOrThrow();
    expect(test).toEqual({ status: 'ignored', detail: 'not_handled' });

    expect((await notify({ signedPayload: 'not-a-jws' })).statusCode).toBe(400);
    expect((await notify({})).statusCode).toBe(400);
  });

  it('applies App Review and TestFlight Sandbox purchases on Production as tests, not sales', async () => {
    // Apple-signed data needs Apple's chain, so Production is stood in for by a verifier
    // that refuses every other environment, and Sandbox by LocalTesting.
    const otherEnvironment = () =>
      Promise.reject(new VerificationException(VerificationStatus.INVALID_ENVIRONMENT));
    const production = {
      verifyAndDecodeTransaction: otherEnvironment,
      verifyAndDecodeNotification: otherEnvironment,
      verifyAndDecodeRenewalInfo: otherEnvironment,
    } as unknown as SignedDataVerifier;
    const sandbox = new SignedDataVerifier([], false, Environment.LOCAL_TESTING, 'app.rabit.ios');
    const cfg = {
      ...h.ctx.config.appStore!,
      environment: 'Production' as const,
      appAppleId: 1,
      acceptSandbox: true,
    };
    const verifier = new AppStoreVerifier(cfg, { primary: production, sandbox });
    const principal = (u: TestUser): Principal => ({
      userId: u.userId as Principal['userId'],
      personalWorkspaceId: u.workspaceId as Principal['personalWorkspaceId'],
      status: 'active',
      isOperator: false,
    });
    const ledgerLines = (orderId: string) =>
      h.ctx.db.selectFrom('ledger_journal').select('id').where('order_id', '=', orderId).execute();

    const reviewer = await krUser();
    const { app_account_token: token } = await status(reviewer);
    const id = `3000000${String(Math.floor(Math.random() * 1e9))}`;
    const bought = transaction({ id, token, expires: Date.now() + 30 * DAY });
    await submitTransaction(h.ctx.db, verifier, principal(reviewer), jws(bought), 'review');
    expect((await status(reviewer)).subscription).toMatchObject({
      state: 'active',
      source: 'app_store',
    });
    expect((await play(reviewer)).statusCode).toBe(201);
    const order = await h.ctx.db
      .selectFrom('purchase_order')
      .select(['id', 'snapshot'])
      .where('checkout_ref', '=', `sandbox:${id}`)
      .executeTakeFirstOrThrow();
    expect(order.snapshot).toMatchObject({ test: true });
    expect(await ledgerLines(order.id)).toEqual([]);

    // The same id from the real App Store is another purchase.
    const buyer = await krUser();
    const real = transaction({
      id,
      token: (await status(buyer)).app_account_token,
      expires: Date.now() + 30 * DAY,
    });
    expect((await submit(buyer, real)).statusCode).toBe(200);

    // Sandbox notifications reach the same URL and follow the test purchase.
    const refund = notification('REFUND', {
      transaction: { ...bought, revocationDate: Date.now(), revocationReason: 0 },
    });
    await receiveNotification(h.ctx.db, verifier, JSON.stringify(refund));
    await h.worker.drain();
    expect((await play(reviewer)).statusCode).toBe(403);
    expect(await ledgerLines(order.id)).toEqual([]);
    expect((await status(buyer)).subscription).toMatchObject({ state: 'active' });

    // Without acceptSandbox, Production refuses Sandbox data as before.
    const strict = new AppStoreVerifier(
      { ...cfg, acceptSandbox: false },
      { primary: production, sandbox: null },
    );
    const other = await krUser();
    const t = transaction({
      id: `${id}9`,
      token: (await status(other)).app_account_token,
      expires: Date.now() + DAY,
    });
    await expect(
      submitTransaction(h.ctx.db, strict, principal(other), jws(t), 'strict'),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses unsigned StoreKit testing in production', () => {
    const base = {
      ...process.env,
      NODE_ENV: 'production',
      AUTH_DEV_ISSUER_ENABLED: 'false',
      PAYMENTS_PROVIDER: 'none',
    };
    expect(() => loadConfig({ ...base, APP_STORE_ENVIRONMENT: 'LocalTesting' })).toThrow(
      /APP_STORE_ENVIRONMENT/,
    );
    expect(() =>
      loadConfig({ ...base, APP_STORE_ENVIRONMENT: 'Production', APP_STORE_ROOT_CERTS: '/x.cer' }),
    ).toThrow(/APP_STORE_APP_APPLE_ID/);
    expect(() => loadConfig({ ...base, APP_STORE_ENVIRONMENT: 'Sandbox' })).toThrow(
      /APP_STORE_ROOT_CERTS/,
    );
  });
});

describe('App Store notifications change only the subscription they belong to (review 2026-10-19)', () => {
  const sub = (u: TestUser) =>
    h.ctx.db
      .selectFrom('subscription')
      .selectAll()
      .where('user_id', '=', u.userId)
      .executeTakeFirstOrThrow();
  const eventDetail = async (original: string, type: string) =>
    await h.ctx.db
      .selectFrom('payment_event')
      .select(['status', 'detail'])
      .where('provider', '=', 'app_store')
      .where('type', 'like', `${type}%`)
      .where(sql<boolean>`payload->>'originalTransactionId' = ${original}`)
      .orderBy('received_at', 'desc')
      .executeTakeFirstOrThrow();

  it('ignores an EXPIRED that arrives after a renewal it predates', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u, 1);
    const first = transaction({ id, token, expires: Date.now() + DAY });
    await notify(
      notification('DID_RENEW', {
        transaction: transaction({
          id: `${id}1`,
          original: id,
          token,
          expires: Date.now() + 31 * DAY,
        }),
      }),
    );
    await h.worker.drain();
    // Apple's EXPIRED for the first period, delivered late.
    await notify(notification('EXPIRED', { transaction: first }, 'VOLUNTARY'));
    await h.worker.drain();
    expect((await status(u)).subscription).toMatchObject({ state: 'active' });
    expect(await eventDetail(id, 'EXPIRED')).toEqual({ status: 'ignored', detail: 'stale' });
  });

  it('leaves a web subscription alone when notifications for an old App Store link arrive', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u, 2);
    // The App Store subscription ends, and the user subscribes on the web.
    await notify(notification('EXPIRED', { autoRenew: 0, original: id }, 'VOLUNTARY'));
    await h.worker.drain();
    const checkout = await h.api.inject({
      method: 'POST',
      url: '/v1/subscription/checkout',
      headers: { ...u.headers, 'idempotency-key': `web-after-store-${id}` },
      payload: {},
    });
    expect(checkout.statusCode, checkout.body).toBe(201);
    const ref = checkout.json<{ checkout_url: string }>().checkout_url.split('/').pop()!;
    await h.api.inject({
      method: 'POST',
      url: `/dev/mock-pay/checkouts/${ref}/complete`,
      payload: { outcome: 'succeeded' },
    });
    await h.worker.drain();
    expect(await sub(u)).toMatchObject({
      state: 'active',
      source: 'sandbox',
      store_original_transaction_id: null,
    });

    const old = transaction({ id, token, expires: Date.now() + 2 * DAY });
    await notify(notification('DID_FAIL_TO_RENEW', { transaction: old }));
    await notify(
      notification('REFUND', {
        transaction: { ...old, revocationDate: Date.now(), revocationReason: 0 },
      }),
    );
    await h.worker.drain();
    expect(await sub(u)).toMatchObject({ state: 'active', source: 'sandbox' });
    expect((await play(u)).statusCode).toBe(201);
  });

  it('keeps access when a past month is refunded, and ends it for the running one', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u, 30);
    const past = transaction({ id: `${id}0`, original: id, token, expires: Date.now() - DAY });
    // The past month was applied earlier (as a renewal); Apple now refunds it.
    await h.ctx.db
      .insertInto('purchase_order')
      .values({
        id: newId('order'),
        user_id: u.userId,
        kind: 'subscription',
        offer_id: null,
        offer_version: null,
        status: 'fulfilled',
        currency: 'KRW',
        amount_minor: 10_900,
        tax_minor: 991,
        snapshot: JSON.stringify({
          kind: 'subscription',
          plan: 'listen_monthly',
          period_months: 1,
          renewal: true,
          territory: 'KR',
          currency: 'KRW',
          amount_minor: 10_900,
          tax_minor: 991,
          vat_rate_bp: 1000,
          capabilities: ['play'],
          terms_version: 'app-store',
        }),
        provider: 'app_store',
        checkout_ref: past.transactionId,
        checkout_url: null,
        entitlement_id: (
          await h.ctx.db
            .selectFrom('entitlement')
            .select('id')
            .where('user_id', '=', u.userId)
            .where('origin', '=', 'subscription')
            .executeTakeFirstOrThrow()
        ).id,
        expires_at: new Date(),
        paid_at: new Date(),
        refunded_at: null,
      })
      .execute();
    await notify(
      notification('REFUND', {
        transaction: { ...past, revocationDate: Date.now(), revocationReason: 0 },
      }),
    );
    await h.worker.drain();
    expect((await status(u)).subscription).toMatchObject({ state: 'active' });

    const current = transaction({ id, token, expires: Date.now() + 30 * DAY });
    await notify(
      notification('REFUND', {
        transaction: { ...current, revocationDate: Date.now(), revocationReason: 0 },
      }),
    );
    await h.worker.drain();
    expect((await status(u)).subscription).toMatchObject({ state: 'cancelled' });
  });

  it('never re-activates a deleted account and drops its App Store link', async () => {
    const u = await krUser();
    const { token, id } = await purchased(u, 2);
    const del = await h.api.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { ...u.headers, 'idempotency-key': `del-store-${u.userId}` },
    });
    expect(del.statusCode).toBe(202);
    await h.worker.drain();
    const link = await h.ctx.db
      .selectFrom('app_store_account')
      .select('user_id')
      .where('user_id', '=', u.userId)
      .execute();
    expect(link).toEqual([]);
    expect(await sub(u)).toMatchObject({ state: 'cancelled', store_original_transaction_id: null });

    await notify(
      notification('DID_RENEW', {
        transaction: transaction({
          id: `${id}1`,
          original: id,
          token,
          expires: Date.now() + 32 * DAY,
        }),
      }),
    );
    await h.worker.drain();
    expect(await sub(u)).toMatchObject({ state: 'cancelled' });
    const orders = await h.ctx.db
      .selectFrom('purchase_order')
      .select('id')
      .where('checkout_ref', '=', `${id}1`)
      .execute();
    expect(orders).toEqual([]);
  });

  it('refuses operator refunds of App Store orders (Apple refunds them)', async () => {
    const u = await krUser();
    const { id } = await purchased(u);
    const order = await h.ctx.db
      .selectFrom('purchase_order')
      .select(['id', 'version'])
      .where('checkout_ref', '=', id)
      .executeTakeFirstOrThrow();
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/orders/${order.id}/refunds`,
      headers: { ...ops.op.headers, 'if-match': `"${String(order.version)}"` },
      payload: { reason: 'customer asked' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/refunded by Apple/);
  });

  it('keeps access through the renewal margin, then lapses', async () => {
    const u = await krUser();
    await purchased(u, 30);
    const s = await sub(u);
    const justEnded = new Date(Date.now() - 3_600_000);
    await h.ctx.db
      .updateTable('subscription')
      .set({ paid_through: justEnded })
      .where('id', '=', s.id)
      .execute();
    await h.ctx.db
      .updateTable('entitlement')
      .set({ valid_to: new Date(justEnded.getTime() + STORE_RENEWAL_MARGIN_MS) })
      .where('user_id', '=', u.userId)
      .where('origin', '=', 'subscription')
      .execute();
    await expireEntitlements(h.ctx.db);
    expect((await sub(u)).state).toBe('active');
    expect((await play(u)).statusCode).toBe(201);

    const long = new Date(Date.now() - STORE_RENEWAL_MARGIN_MS - 3_600_000);
    await h.ctx.db
      .updateTable('subscription')
      .set({ paid_through: long })
      .where('id', '=', s.id)
      .execute();
    await h.ctx.db
      .updateTable('entitlement')
      .set({ valid_to: new Date(long.getTime() + STORE_RENEWAL_MARGIN_MS) })
      .where('user_id', '=', u.userId)
      .where('origin', '=', 'subscription')
      .execute();
    await expireEntitlements(h.ctx.db);
    expect((await sub(u)).state).toBe('expired');
  });
});
