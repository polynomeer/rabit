import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Exploration context on DIG sessions (EX-05): digging under a cutoff. */
let h: Harness;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let u: TestUser;

beforeAll(async () => {
  h = await createHarness();
  const ops = await asOperator(h);
  cat = await seedCatalog(h);
  u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
  // The album on a day; the single (whose track samples the album's) only by year.
  await h.ctx.db
    .updateTable('release')
    .set({ release_date: '1907-04-21', release_date_precision: 'day' })
    .where('id', '=', cat.ids['album']!)
    .execute();
  await h.ctx.db
    .updateTable('release')
    .set({ release_date: '1907-01-01', release_date_precision: 'year' })
    .where('id', '=', cat.ids['single']!)
    .execute();
});
afterAll(() => h.close());

const CUTOFF = '1907-06-15T23:59:59+09:00';
const connections = async (entity: string, axis: string, cutoff?: string) => {
  const q = new URLSearchParams({ axis });
  if (cutoff) {
    q.set('cutoff_at', cutoff);
    q.set('time_zone', 'Asia/Seoul');
  }
  const r = await h.api.inject({
    url: `/v1/dig/entities/${entity}/connections?${q.toString()}`,
    headers: u.headers,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ items: { entity: { entity_id: string } }[] }>().items.map((i) => i.entity.entity_id);
};

describe('DIG under a cutoff (EX-05)', () => {
  it('leaves out recordings and releases that were not out yet', async () => {
    const r1 = cat.ids['r1']!;
    // r3 samples r1 but is only known to be from 1907: not out by mid-June.
    expect(await connections(r1, 'sampled_by')).toContain(cat.ids['r3']);
    expect(await connections(r1, 'sampled_by', CUTOFF)).not.toContain(cat.ids['r3']);
    expect(await connections(r1, 'sampled_by', '1907-12-31T23:00:00+09:00')).toContain(
      cat.ids['r3'],
    );
    // Artists are not dated and always pass.
    expect(await connections(r1, 'artists', CUTOFF)).toContain(cat.ids['band']);
    expect(await connections(r1, 'releases', '1907-04-20T12:00:00+09:00')).toEqual([]);
  });

  it('keeps the context on the session and refuses later steps', async () => {
    const start = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: cat.ids['r1'] },
    });
    expect(start.statusCode, start.body).toBe(201);
    const id = start.json<{ dig_session_id: string }>().dig_session_id;
    const patch = (context: unknown) =>
      h.api.inject({
        method: 'PATCH',
        url: `/v1/dig-sessions/${id}`,
        headers: u.headers,
        payload: { context },
      });
    const set = await patch({ cutoff_at: CUTOFF, time_zone: 'Asia/Seoul' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<{ context: unknown }>().context).toEqual({
      cutoff_at: CUTOFF,
      time_zone: 'Asia/Seoul',
      cutoff: '1907-06-15',
    });
    const reopened = await h.api.inject({ url: `/v1/dig-sessions/${id}`, headers: u.headers });
    expect(reopened.json<{ context: { cutoff: string } }>().context.cutoff).toBe('1907-06-15');

    const step = () =>
      h.api.inject({
        method: 'POST',
        url: `/v1/dig-sessions/${id}/steps`,
        headers: u.headers,
        payload: { entity_id: cat.ids['r3'], axis: 'sampled_by' },
      });
    const refused = await step();
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('INVALID_RELATION_STEP');

    expect((await patch(null)).json<{ context: unknown }>().context).toBeNull();
    expect((await step()).statusCode).toBe(201);
  });

  it('validates the context and keeps it private to the owner', async () => {
    const start = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: cat.ids['r1'] },
    });
    const id = start.json<{ dig_session_id: string }>().dig_session_id;
    const patch = (who: TestUser, context: unknown) =>
      h.api.inject({
        method: 'PATCH',
        url: `/v1/dig-sessions/${id}`,
        headers: who.headers,
        payload: { context },
      });
    expect((await patch(u, { cutoff_at: CUTOFF, time_zone: 'Mars/Base' })).statusCode).toBe(400);
    expect(
      (await patch(u, { cutoff_at: CUTOFF, time_zone: 'UTC', region_id: 'jp' })).statusCode,
    ).toBe(400);
    const other = await h.user();
    expect((await patch(other, { cutoff_at: CUTOFF, time_zone: 'UTC' })).statusCode).toBe(404);
  });
});
