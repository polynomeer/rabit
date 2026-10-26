import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearFlagCache } from '../src/modules/flags/index.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Rediscover and the last-played summary (EX-06, ADR-0035). */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;

const flag = async (enabled: boolean) => {
  const r = await h.api.inject({
    method: 'PUT',
    url: '/v1/ops/features/exploration_rediscover',
    headers: ops.op.headers,
    payload: { override: { enabled, rollout_percent: 100 }, reason: 'rediscover test' },
  });
  expect(r.statusCode, r.body).toBe(200);
  clearFlagCache();
};

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  await flag(true);
});
afterAll(async () => {
  await h.ctx.db.deleteFrom('feature_flag').where('key', '=', 'exploration_rediscover').execute();
  clearFlagCache();
  await h.close();
});

async function listener() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
  return u;
}

async function save(u: TestUser, recording: string) {
  const r = await h.api.inject({
    method: 'POST',
    url: '/v1/library',
    headers: u.headers,
    payload: { ref_type: 'recording', ref_id: recording },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ library_item_id: string }>().library_item_id;
}

/** One catalog session reporting `playedMs`, in one batch (sent twice when `replay`). */
async function listen(u: TestUser, recording: string, playedMs: number, replay = false) {
  const r = await h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: recording, device_id: 'device-rediscover-1' },
  });
  expect(r.statusCode, r.body).toBe(201);
  const sessionId = r.json<{ session_id: string }>().session_id;
  await sql`UPDATE playback_session SET issued_at = now() - interval '10 minutes'
    WHERE id = ${sessionId}`.execute(h.ctx.db);
  const events = [
    { type: 'started', played: 0 },
    { type: 'ended', played: playedMs },
  ].map((e, i) => ({
    event_id: randomUUID(),
    session_id: sessionId,
    sequence: i,
    type: e.type,
    position_ms: 1000,
    played_ms: e.played,
    client_time: new Date().toISOString(),
  }));
  for (let i = 0; i < (replay ? 2 : 1); i++) {
    const res = await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: u.headers,
      payload: { events },
    });
    expect(res.statusCode, res.body).toBe(202);
  }
  await h.worker.drain();
}

const summary = (u: TestUser) =>
  h.ctx.db
    .selectFrom('library_play_summary')
    .selectAll()
    .where('user_id', '=', u.userId)
    .orderBy('recording_id')
    .execute();

type Rediscover = {
  items: {
    library_item_id: string;
    recording: { entity_id: string };
    history: 'played' | 'none';
    last_qualified_at: string | null;
    qualified_plays: number;
    release_date: string | null;
    date_precision: string | null;
  }[];
};
const get = (u: TestUser, query = '') =>
  h.api.inject({ url: `/v1/me/rediscover${query}`, headers: u.headers });

describe('last-played summary', () => {
  it('counts qualified plays of saved recordings once per session, nothing else', async () => {
    const u = await listener();
    await save(u, cat.ids['r1']!);
    await listen(u, cat.ids['r1']!, 60_000, true);
    await listen(u, cat.ids['r1']!, 60_000);
    // Too short to qualify, and a recording that is not saved.
    await listen(u, cat.ids['r1']!, 100);
    await listen(u, cat.ids['r2']!, 60_000);
    const rows = await summary(u);
    expect(rows.map((r) => [r.recording_id, r.qualified_plays])).toEqual([[cat.ids['r1'], 2]]);
  });

  it('goes with the save', async () => {
    const u = await listener();
    const item = await save(u, cat.ids['r1']!);
    await listen(u, cat.ids['r1']!, 60_000);
    expect(await summary(u)).toHaveLength(1);
    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/library/${item}`,
      headers: u.headers,
    });
    expect(del.statusCode, del.body).toBe(204);
    expect(await summary(u)).toEqual([]);
  });
});

describe('Rediscover', () => {
  it('lists saved tracks quiet for long enough, honest about missing history', async () => {
    const u = await listener();
    await save(u, cat.ids['r1']!);
    await save(u, cat.ids['r2']!);
    await listen(u, cat.ids['r1']!, 60_000);
    expect((await get(u)).json<Rediscover>().items).toEqual([]);

    // r1 last played 200 days ago; r2 saved 200 days ago and never played since.
    await h.ctx.db
      .updateTable('library_play_summary')
      .set({ last_qualified_at: new Date(Date.now() - 200 * 86_400_000) })
      .where('user_id', '=', u.userId)
      .execute();
    await h.ctx.db
      .updateTable('library_item')
      .set({ saved_at: new Date(Date.now() - 200 * 86_400_000) })
      .where('user_id', '=', u.userId)
      .where('ref_id', '=', cat.ids['r2']!)
      .execute();
    const r = await get(u);
    expect(r.statusCode, r.body).toBe(200);
    const items = r.json<Rediscover>().items;
    const by = Object.fromEntries(items.map((i) => [i.recording.entity_id, i]));
    expect(by[cat.ids['r1']!]).toMatchObject({ history: 'played', qualified_plays: 1 });
    expect(by[cat.ids['r2']!]).toMatchObject({
      history: 'none',
      last_qualified_at: null,
      release_date: '2025-05-01',
      date_precision: 'day',
    });
    // A shorter window does not change who is quiet; a longer one leaves both out.
    expect((await get(u, '?inactive_days=365')).json<Rediscover>().items).toEqual([]);
  });

  it('clears the history on request and is hidden while its flag is off', async () => {
    const u = await listener();
    await save(u, cat.ids['r1']!);
    await listen(u, cat.ids['r1']!, 60_000);
    const del = await h.api.inject({
      method: 'DELETE',
      url: '/v1/me/rediscover/history',
      headers: u.headers,
    });
    expect(del.statusCode).toBe(204);
    expect(await summary(u)).toEqual([]);

    expect((await get(u, '?inactive_days=7')).statusCode).toBe(400);
    await flag(false);
    try {
      expect((await get(u)).statusCode).toBe(404);
    } finally {
      await flag(true);
    }
  });

  it("never shows another account's saves", async () => {
    const a = await listener();
    const b = await listener();
    await save(a, cat.ids['r1']!);
    await h.ctx.db
      .updateTable('library_item')
      .set({ saved_at: new Date(Date.now() - 400 * 86_400_000) })
      .where('user_id', '=', a.userId)
      .execute();
    expect((await get(b)).json<Rediscover>().items).toEqual([]);
    expect((await get(a)).json<Rediscover>().items).toHaveLength(1);
  });
});
