import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider, renewSubscriptions } from '../src/modules/commerce/index.js';
import { addMonths } from '../src/modules/entitlement/index.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let mock: MockPaymentProvider;
let seq = 0;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  const p = h.ctx.config.payments;
  if (p.provider !== 'mock') throw new Error('tests need PAYMENTS_PROVIDER=mock');
  mock = new MockPaymentProvider(p.webhookSecret, h.ctx.config.http.apiPublicBaseUrl);
});
afterAll(() => h.close());

type Order = {
  order_id: string;
  kind: string;
  status: string;
  checkout_url: string | null;
  version: number;
};
type Sub = { state: string; paid_through: string; auto_renew: boolean } | null;

async function krUser() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  return u;
}

async function checkout(u: TestUser) {
  return h.api.inject({
    method: 'POST',
    url: '/v1/subscription/checkout',
    headers: { ...u.headers, 'idempotency-key': `sub-checkout-${++seq}` },
    payload: {},
  });
}

async function pay(o: Order, outcome: 'succeeded' | 'failed' = 'succeeded') {
  const ref = o.checkout_url!.split('/').pop()!;
  const r = await h.api.inject({
    method: 'POST',
    url: `/dev/mock-pay/checkouts/${ref}/complete`,
    payload: { outcome },
  });
  expect(r.statusCode, r.body).toBe(202);
  await h.worker.drain();
}

async function subscribe(u: TestUser) {
  const r = await checkout(u);
  expect(r.statusCode, r.body).toBe(201);
  await pay(r.json<Order>());
  return r.json<Order>();
}

async function subscription(u: TestUser): Promise<Sub> {
  const r = await h.api.inject({ url: '/v1/subscription/plan', headers: u.headers });
  return r.json<{ current: Sub }>().current;
}

const play = (u: TestUser, rec = cat.ids['r1']) =>
  h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: rec, device_id: 'device-test-1' },
  });

async function setPaidThrough(u: TestUser, at: Date) {
  await h.ctx.db
    .updateTable('subscription')
    .set({ paid_through: at })
    .where('user_id', '=', u.userId)
    .execute();
  await h.ctx.db
    .updateTable('entitlement')
    .set({ valid_to: at })
    .where('user_id', '=', u.userId)
    .where('origin', '=', 'subscription')
    .execute();
}

describe('subscription checkout (COM-008, provisional)', () => {
  it('shows the placeholder plan price with VAT, only for KR accounts', async () => {
    const u = await krUser();
    const r = await h.api.inject({ url: '/v1/subscription/plan', headers: u.headers });
    expect(r.json()).toMatchObject({
      plan: 'listen_monthly',
      period: 'P1M',
      price: { amount_minor: 10_900, currency: 'KRW', tax_minor: 991, tax_included: true },
      available: true,
      checkout_available: true,
      current: null,
    });
    const jp = await h.user();
    await ops.setCountry(jp, 'JP');
    const plan = await h.api.inject({ url: '/v1/subscription/plan', headers: jp.headers });
    expect(plan.json().available).toBe(false);
    const denied = await checkout(jp);
    expect(denied.statusCode).toBe(403);
  });

  it('activates a month of access on payment and books the sale', async () => {
    const u = await krUser();
    expect((await play(u)).statusCode).toBe(403);
    const o = await subscribe(u);
    expect(o.kind).toBe('subscription');
    const sub = await subscription(u);
    expect(sub).toMatchObject({ state: 'active', auto_renew: true });
    const until = new Date(sub!.paid_through).getTime();
    expect(Math.abs(until - addMonths(new Date(), 1).getTime())).toBeLessThan(60_000);
    expect((await play(u)).statusCode).toBe(201);

    const order = await h.api.inject({ url: `/v1/orders/${o.order_id}`, headers: u.headers });
    expect(order.json()).toMatchObject({
      status: 'fulfilled',
      kind: 'subscription',
      plan: 'listen_monthly',
      release_id: null,
    });
    const lines = await h.ctx.db
      .selectFrom('ledger_journal as j')
      .innerJoin('ledger_line as l', 'l.journal_id', 'j.id')
      .select(['l.account', 'l.debit_minor', 'l.credit_minor'])
      .where('j.order_id', '=', o.order_id)
      .execute();
    expect(lines).toEqual(
      expect.arrayContaining([
        { account: 'provider_clearing', debit_minor: 10_900, credit_minor: 0 },
        { account: 'revenue', debit_minor: 0, credit_minor: 9_909 },
        { account: 'vat_payable', debit_minor: 0, credit_minor: 991 },
      ]),
    );

    // Not sold twice while it renews.
    expect((await checkout(u)).statusCode).toBe(409);
  });

  it('stops renewal without ending the paid month and charges nothing', async () => {
    const u = await krUser();
    await subscribe(u);
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/subscription/cancel',
      headers: u.headers,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().subscription).toMatchObject({ state: 'active', auto_renew: false });
    expect((await play(u)).statusCode).toBe(201);
    // Paying again while the month runs is refused; renewal is turned back on instead.
    expect((await checkout(u)).statusCode).toBe(409);
    const resumed = await h.api.inject({
      method: 'POST',
      url: '/v1/subscription/resume',
      headers: u.headers,
    });
    expect(resumed.json().subscription).toMatchObject({ state: 'active', auto_renew: true });
    await h.api.inject({ method: 'POST', url: '/v1/subscription/cancel', headers: u.headers });
    // Nothing is charged near the end, and access ends at the paid-through date.
    await setPaidThrough(u, new Date(Date.now() + 3_600_000));
    await renewSubscriptions(h.ctx.db, mock, h.ctx.config.subscription, h.ctx.log);
    await h.worker.drain();
    const orders = await h.api.inject({ url: '/v1/orders', headers: u.headers });
    expect(orders.json().items).toHaveLength(1);
  });
});

describe('renewal', () => {
  it('charges the stored card a day ahead and extends from the paid-through date', async () => {
    const u = await krUser();
    await subscribe(u);
    const end = new Date(Date.now() + 2 * 3_600_000);
    await setPaidThrough(u, end);
    expect(
      await renewSubscriptions(h.ctx.db, mock, h.ctx.config.subscription, h.ctx.log),
    ).toBeGreaterThanOrEqual(1);
    await h.worker.drain();
    const sub = await subscription(u);
    expect(sub).toMatchObject({ state: 'active', auto_renew: true });
    expect(new Date(sub!.paid_through).getTime()).toBe(addMonths(end, 1).getTime());
    const orders = (await h.api.inject({ url: '/v1/orders', headers: u.headers })).json<{
      items: { status: string; renewal: boolean }[];
    }>().items;
    expect(orders.map((o) => [o.status, o.renewal])).toEqual([
      ['fulfilled', true],
      ['fulfilled', false],
    ]);
    // Not charged again for the same period.
    expect(
      await renewSubscriptions(h.ctx.db, mock, h.ctx.config.subscription, h.ctx.log, new Date()),
    ).toBe(0);
  });

  it('makes the subscription past due when the card is declined; paying again restores it', async () => {
    const u = await krUser();
    await subscribe(u);
    const card = await h.api.inject({
      method: 'PUT',
      url: `/dev/mock-pay/cards/${u.userId}`,
      payload: { declined: true },
    });
    expect(card.statusCode).toBe(200);
    await setPaidThrough(u, new Date(Date.now() + 3_600_000));
    await renewSubscriptions(h.ctx.db, mock, h.ctx.config.subscription, h.ctx.log);
    await h.worker.drain();
    expect((await subscription(u))?.state).toBe('past_due');
    const denied = await play(u);
    expect(denied.statusCode).toBe(403);

    const again = await checkout(u);
    expect(again.statusCode, again.body).toBe(201);
    await pay(again.json<Order>());
    expect((await subscription(u))?.state).toBe('active');
    expect((await play(u)).statusCode).toBe(201);
  });

  it('never renews a subscription an operator set', async () => {
    const u = await krUser();
    await ops.subscribe(u);
    expect((await subscription(u))?.auto_renew).toBe(false);
    await setPaidThrough(u, new Date(Date.now() + 3_600_000));
    await renewSubscriptions(h.ctx.db, mock, h.ctx.config.subscription, h.ctx.log);
    const orders = await h.api.inject({ url: '/v1/orders', headers: u.headers });
    expect(orders.json().items).toHaveLength(0);
  });
});

describe('refund of a subscription payment', () => {
  it('ends access immediately and leaves bought albums playable (COM-009)', async () => {
    const u = await krUser();
    const offer = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: ops.op.headers,
      payload: {
        release_id: (await seedCatalog(h)).ids['album'],
        territories: ['KR'],
        price_minor: 5_000,
        reason: 'test',
      },
    });
    const album = offer.json<{ offer_id: string; release_id: string }>();
    const bought = await h.api.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...u.headers, 'idempotency-key': `album-order-${++seq}` },
      payload: { offer_id: album.offer_id },
    });
    await pay(bought.json<Order>());
    const sub = await subscribe(u);

    const o = (
      await h.api.inject({ url: `/v1/orders/${sub.order_id}`, headers: u.headers })
    ).json<Order>();
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/orders/${sub.order_id}/refunds`,
      headers: { ...ops.op.headers, 'if-match': `"${o.version}"` },
      payload: { reason: 'withdrawal within 7 days' },
    });
    expect(r.statusCode, r.body).toBe(202);
    await h.worker.drain();
    expect(await subscription(u)).toMatchObject({ state: 'cancelled', auto_renew: false });
    expect((await play(u)).statusCode).toBe(403);
    const albumTracks = await h.ctx.db
      .selectFrom('release_track')
      .select('recording_id')
      .where('release_id', '=', album.release_id)
      .orderBy('position')
      .execute();
    expect((await play(u, albumTracks[0]!.recording_id)).statusCode).toBe(201);
  });
});

describe('addMonths', () => {
  it('keeps the day, clamped to the end of shorter months', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
    expect(addMonths(new Date('2026-10-09T00:00:00Z'), 1).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    );
    expect(addMonths(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });
});
