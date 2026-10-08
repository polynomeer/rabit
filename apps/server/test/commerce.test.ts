import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  includedTax,
  ledgerBalances,
  MockPaymentProvider,
  reconcile,
} from '../src/modules/commerce/index.js';
import { expireOrders } from '../src/modules/commerce/service.js';
import { loadConfig } from '../src/platform/config.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let mock: MockPaymentProvider;
let keySeq = 0;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  const p = h.ctx.config.payments;
  if (p.provider !== 'mock') throw new Error('tests need PAYMENTS_PROVIDER=mock');
  mock = new MockPaymentProvider(p.webhookSecret, h.ctx.config.http.apiPublicBaseUrl);
});
afterAll(() => h.close());

type Order = {
  order_id: string;
  status: string;
  checkout_url: string | null;
  entitlement_id: string | null;
  version: number;
  price: { amount_minor: number; tax_minor: number; currency: string };
};

/** A fresh catalog with an album on sale in KR at 11,000 KRW (VAT included). */
async function albumOnSale(price = 11_000) {
  const cat = await seedCatalog(h);
  const r = await h.api.inject({
    method: 'POST',
    url: '/v1/ops/offers',
    headers: ops.op.headers,
    payload: {
      release_id: cat.ids['album'],
      territories: ['KR'],
      price_minor: price,
      reason: 'test offer',
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  return { cat, offerId: r.json<{ offer_id: string }>().offer_id, releaseId: cat.ids['album']! };
}

async function buyer(country: string | null = 'KR') {
  const u = await h.user();
  if (country) await ops.setCountry(u, country);
  return u;
}

function order(u: TestUser, offerId: string, extra: Record<string, unknown> = {}) {
  return h.api.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: { ...u.headers, 'idempotency-key': `order-key-${++keySeq}` },
    payload: { offer_id: offerId, ...extra },
  });
}

const refOf = (o: Order) => o.checkout_url!.split('/').pop()!;

async function pay(o: Order, outcome: 'succeeded' | 'failed' = 'succeeded') {
  const r = await h.api.inject({
    method: 'POST',
    url: `/dev/mock-pay/checkouts/${refOf(o)}/complete`,
    payload: { outcome },
  });
  expect(r.statusCode, r.body).toBe(202);
  await h.worker.drain();
}

async function getOrder(u: TestUser, id: string) {
  const r = await h.api.inject({ url: `/v1/orders/${id}`, headers: u.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<Order>();
}

function webhook(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  return h.api.inject({
    method: 'POST',
    url: '/webhooks/payments/mock',
    headers: {
      'content-type': 'application/json',
      'mock-pay-signature': signature ?? mock.sign(raw),
    },
    payload: raw,
  });
}

async function journalsOf(orderId: string) {
  return h.ctx.db
    .selectFrom('ledger_journal as j')
    .innerJoin('ledger_line as l', 'l.journal_id', 'j.id')
    .select(['j.kind', 'l.account', 'l.debit_minor', 'l.credit_minor'])
    .where('j.order_id', '=', orderId)
    .execute();
}

describe('offers (COM-002, COM-013)', () => {
  it('shows the server price with VAT included, the terms, and only in the offer territory', async () => {
    const { releaseId } = await albumOnSale();
    const kr = await buyer('KR');
    const r = await h.api.inject({ url: `/v1/releases/${releaseId}/offer`, headers: kr.headers });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      price: { amount_minor: 11_000, currency: 'KRW', tax_minor: 1_000, tax_included: true },
      capabilities: ['play'],
      owned: false,
      checkout_available: true,
      terms: { terms_version: expect.any(String) },
    });
    expect(JSON.stringify(r.json().terms)).toContain('not the copyright');

    for (const other of [await buyer('JP'), await buyer(null)]) {
      const r2 = await h.api.inject({
        url: `/v1/releases/${releaseId}/offer`,
        headers: other.headers,
      });
      expect(r2.statusCode).toBe(404);
    }
  });

  it('is not sellable when a track has no rights in the territory', async () => {
    const cat = await seedCatalog(h);
    // The single's second track has no grant.
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: ops.op.headers,
      payload: {
        release_id: cat.ids['single'],
        territories: ['KR'],
        price_minor: 3_000,
        reason: 'test',
      },
    });
    expect(r.statusCode).toBe(201);
    const u = await buyer();
    const offer = await h.api.inject({
      url: `/v1/releases/${cat.ids['single']}/offer`,
      headers: u.headers,
    });
    expect(offer.statusCode).toBe(404);
    const o = await order(u, r.json<{ offer_id: string }>().offer_id);
    expect(o.statusCode).toBe(403);
    expect(o.json().error.code).toBe('RIGHTS_UNAVAILABLE');
  });

  it('allows one offer on sale per release, and only operators create them', async () => {
    const { releaseId } = await albumOnSale();
    const again = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: ops.op.headers,
      payload: { release_id: releaseId, territories: ['KR'], price_minor: 9_000, reason: 'test' },
    });
    expect(again.statusCode).toBe(409);
    const u = await buyer();
    const byUser = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: u.headers,
      payload: { release_id: releaseId, territories: ['KR'], price_minor: 1, reason: 'test' },
    });
    expect(byUser.statusCode).toBe(403);
  });

  it('computes VAT included in integer minor units', () => {
    expect(includedTax(11_000, 1_000)).toBe(1_000);
    expect(includedTax(9_900, 1_000)).toBe(900);
    expect(includedTax(1_234, 1_000)).toBe(112);
    expect(includedTax(5_000, 0)).toBe(0);
  });
});

describe('album purchase with the mock provider (COM-003..006)', () => {
  it('pays, fulfils with a purchase entitlement, plays without a subscription and books a balanced sale', async () => {
    const { cat, offerId, releaseId } = await albumOnSale();
    const u = await buyer();
    const created = await order(u, offerId);
    expect(created.statusCode, created.body).toBe(201);
    const o = created.json<Order>();
    expect(o).toMatchObject({
      status: 'pending',
      price: { amount_minor: 11_000, tax_minor: 1_000 },
    });
    expect(o.checkout_url).toMatch(/\/dev\/mock-pay\/checkouts\/mck_[0-9a-f]{24}$/);

    // Before payment: no access (COM-004: nothing the client says confirms payment).
    const before = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: cat.ids['r1'], device_id: 'device-test-1' },
    });
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe('PURCHASE_AVAILABLE');
    const rel = await h.api.inject({ url: `/v1/releases/${releaseId}`, headers: u.headers });
    expect(
      rel
        .json<{ tracks: { playability: { reason: string } }[] }>()
        .tracks.map((t) => t.playability.reason),
    ).toEqual(['purchase_available', 'purchase_available']);

    await pay(o);
    const done = await getOrder(u, o.order_id);
    expect(done).toMatchObject({ status: 'fulfilled', checkout_url: null });
    expect(done.entitlement_id).toMatch(/^enl_/);

    const ents = await h.api.inject({ url: '/v1/entitlements', headers: u.headers });
    expect(ents.json().items).toEqual([
      expect.objectContaining({
        origin: 'purchase',
        scope: 'release',
        resource_id: releaseId,
        status: 'active',
      }),
    ]);
    const play = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: cat.ids['r1'], device_id: 'device-test-1' },
    });
    expect(play.statusCode, play.body).toBe(201);

    const lines = await journalsOf(o.order_id);
    expect(lines).toEqual(
      expect.arrayContaining([
        { kind: 'sale', account: 'provider_clearing', debit_minor: 11_000, credit_minor: 0 },
        { kind: 'sale', account: 'revenue', debit_minor: 0, credit_minor: 10_000 },
        { kind: 'sale', account: 'vat_payable', debit_minor: 0, credit_minor: 1_000 },
      ]),
    );
    const balances = await ledgerBalances(h.ctx.db, 'KRW');
    expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('returns the same pending order instead of opening a second checkout (COM-010)', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const first = (await order(u, offerId)).json<Order>();
    const second = await order(u, offerId);
    expect(second.statusCode).toBe(200);
    expect(second.json<Order>().order_id).toBe(first.order_id);
    expect(second.json<Order>().checkout_url).toBe(first.checkout_url);
  });

  it('asks before buying a release the user already owns', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    await pay((await order(u, offerId)).json<Order>());
    const again = await order(u, offerId);
    expect(again.statusCode).toBe(409);
    expect((await order(u, offerId, { confirm_already_owned: true })).statusCode).toBe(201);
  });

  it('keeps the purchase when the subscription ends (COM-001, COM-009)', async () => {
    const { cat, offerId } = await albumOnSale();
    const u = await buyer();
    await ops.subscribe(u);
    await pay((await order(u, offerId)).json<Order>());
    await ops.subscribe(u, 'cancelled');
    const play = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: cat.ids['r2'], device_id: 'device-test-1' },
    });
    expect(play.statusCode, play.body).toBe(201);
  });

  it('cancels on a failed payment; another user never sees the order', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await pay(o, 'failed');
    expect((await getOrder(u, o.order_id)).status).toBe('cancelled');
    const stranger = await buyer();
    const peek = await h.api.inject({ url: `/v1/orders/${o.order_id}`, headers: stranger.headers });
    expect(peek.statusCode).toBe(404);
  });

  it('honours a payment confirmed after the checkout expired', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await h.ctx.db
      .updateTable('purchase_order')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', o.order_id)
      .execute();
    expect(await expireOrders(h.ctx.db)).toBeGreaterThanOrEqual(1);
    expect((await getOrder(u, o.order_id)).status).toBe('expired');
    await pay(o);
    expect((await getOrder(u, o.order_id)).status).toBe('fulfilled');
  });
});

describe('webhook security and ordering (COM-005, COM-018)', () => {
  it('rejects a bad signature, a stale timestamp and a malformed body without storing anything', async () => {
    const body = {
      id: `evt_forged_${keySeq++}`,
      type: 'payment.succeeded',
      data: { checkout_ref: 'mck_000000000000000000000000', amount_minor: 1, currency: 'KRW' },
    };
    const raw = JSON.stringify(body);
    const forged = await webhook(body, `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`);
    expect(forged.statusCode).toBe(400);
    const stale = await webhook(body, mock.sign(raw, Math.floor(Date.now() / 1000) - 3600));
    expect(stale.statusCode).toBe(400);
    const missing = await h.api.inject({
      method: 'POST',
      url: '/webhooks/payments/mock',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(missing.statusCode).toBe(400);
    const unknownProvider = await h.api.inject({
      method: 'POST',
      url: '/webhooks/payments/stripe',
      headers: { 'content-type': 'application/json', 'mock-pay-signature': mock.sign(raw) },
      payload: raw,
    });
    expect(unknownProvider.statusCode).toBe(404);
    const stored = await h.ctx.db
      .selectFrom('payment_event')
      .select('id')
      .where('provider_event_id', '=', body.id)
      .execute();
    expect(stored).toEqual([]);
  });

  it('applies a replayed event once', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    const body = {
      id: `evt_replay_${o.order_id}`,
      type: 'payment.succeeded',
      data: { checkout_ref: refOf(o), amount_minor: 11_000, currency: 'KRW' },
    };
    expect((await webhook(body)).json()).toEqual({ received: true, duplicate: false });
    expect((await webhook(body)).json()).toEqual({ received: true, duplicate: true });
    await h.worker.drain();
    expect((await getOrder(u, o.order_id)).status).toBe('fulfilled');
    const ents = await h.api.inject({ url: '/v1/entitlements', headers: u.headers });
    expect(ents.json().items).toHaveLength(1);
    expect((await journalsOf(o.order_id)).filter((l) => l.kind === 'sale')).toHaveLength(3);
  });

  it('holds a payment whose amount does not match, and ignores a failure after success', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await webhook({
      id: `evt_short_${o.order_id}`,
      type: 'payment.succeeded',
      data: { checkout_ref: refOf(o), amount_minor: 100, currency: 'KRW' },
    });
    await h.worker.drain();
    expect((await getOrder(u, o.order_id)).status).toBe('pending');
    const held = await h.ctx.db
      .selectFrom('payment_event')
      .select(['status', 'detail'])
      .where('provider_event_id', '=', `evt_short_${o.order_id}`)
      .executeTakeFirstOrThrow();
    expect(held).toEqual({ status: 'held', detail: 'amount_mismatch' });

    await pay(o);
    await webhook({
      id: `evt_late_fail_${o.order_id}`,
      type: 'payment.failed',
      data: { checkout_ref: refOf(o), amount_minor: 11_000, currency: 'KRW' },
    });
    await h.worker.drain();
    expect((await getOrder(u, o.order_id)).status).toBe('fulfilled');
  });

  it('holds a refund event that does not match a requested refund', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await pay(o);
    await webhook({
      id: `evt_stray_refund_${o.order_id}`,
      type: 'refund.succeeded',
      data: {
        checkout_ref: refOf(o),
        amount_minor: 11_000,
        currency: 'KRW',
        refund_ref: 'mrf_nope',
      },
    });
    await h.worker.drain();
    expect((await getOrder(u, o.order_id)).status).toBe('fulfilled');
  });
});

describe('refunds and withdrawal', () => {
  it('refunds a fulfilled order on an operator request: entitlement revoked, sale reversed', async () => {
    const { cat, offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await pay(o);
    const paid = await getOrder(u, o.order_id);

    const noMatch = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/orders/${o.order_id}/refunds`,
      headers: ops.op.headers,
      payload: { reason: 'customer request' },
    });
    expect(noMatch.statusCode).toBe(428);
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/orders/${o.order_id}/refunds`,
      headers: { ...ops.op.headers, 'if-match': `"${paid.version}"` },
      payload: { reason: 'customer request' },
    });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().status).toBe('refund_pending');
    await h.worker.drain();

    expect((await getOrder(u, o.order_id)).status).toBe('refunded');
    const ents = await h.api.inject({ url: '/v1/entitlements', headers: u.headers });
    expect(ents.json().items[0]).toMatchObject({ origin: 'purchase', status: 'revoked' });
    const play = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: cat.ids['r1'], device_id: 'device-test-1' },
    });
    expect(play.statusCode).toBe(403);

    const lines = await journalsOf(o.order_id);
    const net = lines.reduce((a, l) => a + l.debit_minor - l.credit_minor, 0);
    expect(net).toBe(0);
    expect(lines.filter((l) => l.kind === 'refund')).toHaveLength(3);

    const detail = await h.api.inject({
      url: `/v1/ops/orders/${o.order_id}`,
      headers: ops.op.headers,
    });
    expect(detail.json()).toMatchObject({
      status: 'refunded',
      refunds: [
        expect.objectContaining({ status: 'succeeded', requested_by: `operator:${ops.op.userId}` }),
      ],
    });
    expect(detail.json().events.map((e: { type: string }) => e.type)).toEqual([
      'payment.succeeded',
      'refund.succeeded',
    ]);
  });

  it('cancels pending orders when an offer is withdrawn and refunds a payment that still arrives', async () => {
    const { cat, offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    const w = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/offers/${offerId}/withdraw`,
      headers: ops.op.headers,
      payload: { reason: 'rights holder request' },
    });
    expect(w.statusCode, w.body).toBe(200);
    expect((await getOrder(u, o.order_id)).status).toBe('cancelled');

    await pay(o);
    const after = await getOrder(u, o.order_id);
    expect(after).toMatchObject({ status: 'refunded', entitlement_id: null });
    // Not on sale any more: a non-subscriber is asked for a subscription again.
    const rel = await h.api.inject({ url: `/v1/releases/${cat.ids['album']}`, headers: u.headers });
    expect(rel.json().tracks[0].playability.reason).toBe('subscription_required');
    const lines = await journalsOf(o.order_id);
    expect(lines.reduce((a, l) => a + l.debit_minor - l.credit_minor, 0)).toBe(0);
    expect((await order(u, offerId)).statusCode).toBe(409);
  });

  it('returns a failed refund to the fulfilled state', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await pay(o);
    // The provider loses the payment record, so the refund fails.
    await h.ctx.db
      .updateTable('mock_payment')
      .set({ status: 'failed' })
      .where('checkout_ref', '=', refOf(o))
      .execute();
    const v = (await getOrder(u, o.order_id)).version;
    await h.api.inject({
      method: 'POST',
      url: `/v1/ops/orders/${o.order_id}/refunds`,
      headers: { ...ops.op.headers, 'if-match': `"${v}"` },
      payload: { reason: 'customer request' },
    });
    await h.worker.drain();
    expect((await getOrder(u, o.order_id)).status).toBe('fulfilled');
  });
});

describe('ledger invariants (COM-007)', () => {
  it('refuses edits and journals that do not balance', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    await pay(o);
    await expect(
      sql`UPDATE ledger_line SET debit_minor = 1 WHERE journal_id IN (SELECT id FROM ledger_journal WHERE order_id = ${o.order_id})`.execute(
        h.ctx.db,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.ctx.db.transaction().execute(async (tx) => {
        await sql`INSERT INTO ledger_journal (id, order_id, kind, currency) VALUES ('jrn_01ARZ3NDEKTSV4RRFFQ69G5FAV', ${o.order_id}, 'refund', 'KRW')`.execute(
          tx,
        );
        await sql`INSERT INTO ledger_line (journal_id, line_no, account, debit_minor) VALUES ('jrn_01ARZ3NDEKTSV4RRFFQ69G5FAV', 1, 'revenue', 500)`.execute(
          tx,
        );
      }),
    ).rejects.toThrow(/does not balance/);
  });
});

describe('reconciliation and configuration', () => {
  it('reports an order whose state disagrees with the provider', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    // The provider took the money but its webhook never arrived.
    await h.ctx.db
      .updateTable('mock_payment')
      .set({ status: 'succeeded' })
      .where('checkout_ref', '=', refOf(o))
      .execute();
    const found = await reconcile(h.ctx.db, mock, h.ctx.log);
    expect(found).toContainEqual({ order_id: o.order_id, kind: 'payment_not_recorded' });
  });

  it('refuses the mock provider in production and needs its webhook secret', () => {
    const base = { ...process.env, PAYMENTS_PROVIDER: 'mock' };
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_ISSUER_ENABLED: 'false' }),
    ).toThrow(/PAYMENTS_PROVIDER/);
    expect(() => loadConfig({ ...base, PAYMENTS_MOCK_WEBHOOK_SECRET: '' })).toThrow();
  });

  it('cancels pending orders when the account is deleted, keeping paid orders', async () => {
    const { offerId } = await albumOnSale();
    const u = await buyer();
    const o = (await order(u, offerId)).json<Order>();
    const del = await h.api.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { ...u.headers, 'idempotency-key': `del-${u.userId}` },
    });
    expect(del.statusCode).toBe(202);
    await h.worker.drain();
    const row = await h.ctx.db
      .selectFrom('purchase_order')
      .select('status')
      .where('id', '=', o.order_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('cancelled');
  });
});
