import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Home shelves: new releases (dig) and albums on sale (commerce). */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  // Newest in the shared test database, whatever other suites ingest.
  await h.ctx.db
    .updateTable('release')
    .set({ release_date: '2099-01-01' })
    .where('id', '=', cat.ids['album']!)
    .execute();
});
afterAll(() => h.close());

async function user(country: string, subscribed: boolean) {
  const u = await h.user();
  await ops.setCountry(u, country);
  if (subscribed) await ops.subscribe(u);
  return u;
}

type ShelfItem = {
  release: { release_id: string; title: string; release_date: string | null };
  artists: { name: string }[];
  available_tracks: number;
  playable_tracks: number;
};

const shelf = async (u: TestUser) => {
  const r = await h.api.inject({ url: '/v1/dig/new-releases?size=24', headers: u.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ items: ShelfItem[] }>().items;
};

describe('new releases shelf', () => {
  it('lists the newest releases available in the region, playable or not yet', async () => {
    const listener = await user('KR', true);
    const browsing = await user('KR', false);
    const [mine] = (await shelf(listener)).filter((i) => i.release.release_id === cat.ids['album']);
    expect(mine).toMatchObject({
      release: { release_date: '2099-01-01' },
      artists: [{ name: expect.stringMatching(/^The Test Tones/) }],
      available_tracks: 2,
      playable_tracks: 2,
    });
    expect((await shelf(listener))[0]?.release.release_id).toBe(cat.ids['album']);
    // Without a plan the album is still on the shelf (a subscription opens it).
    const [browse] = (await shelf(browsing)).filter(
      (i) => i.release.release_id === cat.ids['album'],
    );
    expect(browse).toMatchObject({ available_tracks: 2, playable_tracks: 0 });
  });

  it('leaves out releases with no rights in the region', async () => {
    const abroad = await user('JP', true);
    expect((await shelf(abroad)).map((i) => i.release.release_id)).not.toContain(cat.ids['album']);
  });
});

describe('offers on sale shelf', () => {
  it('lists albums on sale in the region with their price, until withdrawn', async () => {
    const created = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/offers',
      headers: ops.op.headers,
      payload: {
        release_id: cat.ids['album'],
        territories: ['KR'],
        price_minor: 9_900,
        reason: 'home shelf test',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const offerId = created.json<{ offer_id: string }>().offer_id;

    const kr = await user('KR', false);
    const list = await h.api.inject({ url: '/v1/offers?limit=24', headers: kr.headers });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({
        offer_id: offerId,
        release: expect.objectContaining({ release_id: cat.ids['album'] }),
        artists: [expect.objectContaining({ name: expect.stringMatching(/^The Test Tones/) })],
        price: { amount_minor: 9_900, currency: 'KRW', tax_minor: 900, tax_included: true },
      }),
    );

    const jp = await user('JP', false);
    const abroad = await h.api.inject({ url: '/v1/offers', headers: jp.headers });
    expect(JSON.stringify(abroad.json())).not.toContain(offerId);

    const { version } = (
      await h.api.inject({
        url: `/v1/ops/releases/${cat.ids['album']!}/offers`,
        headers: ops.op.headers,
      })
    )
      .json<{ items: { offer_id: string; version: number }[] }>()
      .items.find((o) => o.offer_id === offerId)!;
    const withdrawn = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/offers/${offerId}/withdraw`,
      headers: { ...ops.op.headers, 'if-match': `"${String(version)}"` },
      payload: { reason: 'home shelf test' },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    const after = await h.api.inject({ url: '/v1/offers?limit=24', headers: kr.headers });
    expect(JSON.stringify(after.json())).not.toContain(offerId);
  });

  it('is empty for an account without a licence country', async () => {
    const u = await h.user();
    const r = await h.api.inject({ url: '/v1/offers', headers: u.headers });
    expect(r.json()).toEqual({ items: [] });
  });
});
