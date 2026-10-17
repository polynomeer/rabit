import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/platform/config.js';
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
        { account: 'provider_clearing', debit_minor: 10_900, credit_minor: 0 },
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

    expect((await notify({ signedPayload: 'not-a-jws' })).statusCode).toBe(400);
    expect((await notify({})).statusCode).toBe(400);
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
