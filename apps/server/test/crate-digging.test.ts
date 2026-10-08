import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let listener: TestUser;
beforeAll(async () => {
  h = await createHarness();
  const ops = await asOperator(h);
  cat = await seedCatalog(h);
  listener = await h.user();
  await ops.setCountry(listener, 'KR');
  await ops.subscribe(listener);
  // A year no other fixture uses, so the crate below is deterministic.
  await h.ctx.db
    .updateTable('release')
    .set({ release_date: '1901-06-01' })
    .where('id', 'in', [cat.ids['album']!, cat.ids['single']!])
    .execute();
});
afterAll(() => h.close());

type Crate = {
  items: {
    release: { release_id: string; release_date: string | null };
    artists: { entity_id: string }[];
    label: { entity_id: string } | null;
    playable_tracks: number;
    popularity_tier: string;
  }[];
};
const crate = (u: TestUser, query: string) =>
  h.api.inject({ url: `/v1/dig/crate?${query}`, headers: u.headers });

describe('Crate Digging, private (DIG-009)', () => {
  it('fills a crate with albums of the era that the listener can play', async () => {
    const r = await crate(listener, 'from=1901&to=1901&size=12');
    expect(r.statusCode, r.body).toBe(200);
    const items = r.json<Crate>().items;
    expect(items.map((i) => i.release.release_id).sort()).toEqual(
      [cat.ids['album'], cat.ids['single']].sort(),
    );
    const album = items.find((i) => i.release.release_id === cat.ids['album'])!;
    expect(album.playable_tracks).toBe(2);
    expect(album.label?.entity_id).toBe(cat.ids['label']);
    expect(album.artists.length).toBeGreaterThan(0);
  });

  it("filters by the most popular track's popularity", async () => {
    await h.ctx.db
      .insertInto('recording_popularity')
      .values({
        recording_id: cat.ids['r1']!,
        window_days: 28,
        distinct_listeners: 500,
        plays: 5000,
        percentile: 0.95,
        tier: 'top',
        policy_version: 'test',
      })
      .onConflict((oc) => oc.column('recording_id').doUpdateSet({ percentile: 0.95, tier: 'top' }))
      .execute();
    const items = (await crate(listener, 'from=1901&to=1901&popularity=deep_cuts')).json<Crate>()
      .items;
    expect(items.map((i) => i.release.release_id)).toEqual([cat.ids['single']]);
    const any = (await crate(listener, 'from=1901&to=1901&popularity=any')).json<Crate>().items;
    expect(any.find((i) => i.release.release_id === cat.ids['album'])?.popularity_tier).toBe('top');
  });

  it('never deals albums the caller cannot play', async () => {
    const stranger = await h.user();
    expect((await crate(stranger, 'from=1901&to=1901')).json<Crate>().items).toEqual([]);
  });

  it('respects the size and validates the era', async () => {
    const items = (await crate(listener, 'size=1')).json<Crate>().items;
    expect(items.length).toBeLessThanOrEqual(1);
    expect((await crate(listener, 'from=2000&to=1990')).statusCode).toBe(400);
    expect((await crate(listener, 'size=99')).statusCode).toBe(400);
  });
});
