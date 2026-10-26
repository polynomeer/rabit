import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordingsOutBy } from '../src/modules/catalog/index.js';
import { clearFlagCache } from '../src/modules/flags/index.js';
import { advanceCutoff } from '../src/modules/playback/queue.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Time Radio through the account queue (ADR-0034), on the cutoff rule of ADR-0033. */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;

const flag = async (enabled: boolean) => {
  const r = await h.api.inject({
    method: 'PUT',
    url: '/v1/ops/features/exploration_time_machine',
    headers: ops.op.headers,
    payload: { override: { enabled, rollout_percent: 100 }, reason: 'time radio test' },
  });
  expect(r.statusCode, r.body).toBe(200);
  clearFlagCache();
};

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  // Years no other fixture uses: the album on a day, the single known only by year.
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
  await flag(true);
});
afterAll(async () => {
  await h.ctx.db.deleteFrom('feature_flag').where('key', '=', 'exploration_time_machine').execute();
  clearFlagCache();
  await h.close();
});

async function listener() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
  return u;
}

type Queue = {
  mode: string;
  current_item_id: string | null;
  time_machine: { cutoff: string; cutoff_at: string; time_zone: string; mode: string } | null;
  new_since_previous?: number;
  items: {
    item_id: string;
    origin: 'user' | 'autoplay';
    state: string;
    recording_id: string | null;
    reason: {
      code: string;
      release_date?: string;
      date_precision?: string;
      cutoff?: string;
    } | null;
  }[];
};
const call = (u: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  h.api.inject({ method, url, headers: u.headers, ...(payload ? { payload } : {}) });
const start = async (u: TestUser, body: Record<string, unknown>) => {
  const r = await call(u, 'POST', '/v1/queue/time-machine', {
    time_zone: 'Asia/Seoul',
    ...body,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<Queue>();
};
const suggested = (q: Queue) =>
  q.items.filter((i) => i.origin === 'autoplay' && i.state !== 'played');
const recs = (q: Queue) => q.items.map((i) => i.recording_id);

/** Every suggestion was out by the cutoff its reason names. */
async function noLeaks(q: Queue) {
  const ids = suggested(q).flatMap((i) => (i.recording_id ? [i.recording_id] : []));
  const cutoff = q.time_machine?.cutoff ?? '';
  const out = await recordingsOutBy(h.ctx.db, ids, cutoff);
  expect(ids.filter((id) => !out.has(id))).toEqual([]);
}

describe('Time Radio', () => {
  it('starts from music out by the cutoff and plays its first suggestion', async () => {
    const u = await listener();
    const q = await start(u, { cutoff_at: '1907-06-15T23:59:59+09:00' });
    expect(q.mode).toBe('time_machine');
    expect(q.time_machine).toMatchObject({
      cutoff: '1907-06-15',
      time_zone: 'Asia/Seoul',
      mode: 'free_explore',
    });
    expect(recs(q)).toEqual(expect.arrayContaining([cat.ids['r1'], cat.ids['r2']]));
    // The single is known only by its year: it could still be unreleased in June.
    expect(recs(q)).not.toContain(cat.ids['r3']);
    const current = q.items.find((i) => i.item_id === q.current_item_id);
    expect(current?.origin).toBe('autoplay');
    expect(current?.reason).toMatchObject({ code: 'time_machine', cutoff: '1907-06-15' });
    const r1 = q.items.find((i) => i.recording_id === cat.ids['r1']);
    expect(r1?.reason).toMatchObject({ release_date: '1907-04-21', date_precision: 'day' });
    await noLeaks(q);
  });

  it('moves the cutoff by months and says what came out in between', async () => {
    const u = await listener();
    const first = await start(u, { cutoff_at: '1907-05-31T12:00:00+09:00' });
    expect(first.current_item_id).not.toBeNull();
    const r = await call(u, 'POST', '/v1/queue/time-machine/advance', { months: 6 });
    expect(r.statusCode, r.body).toBe(200);
    const q = r.json<Queue>();
    expect(q.time_machine?.cutoff).toBe('1907-11-30');
    // The track playing keeps playing; only what comes next changes.
    expect(q.current_item_id).toBe(first.current_item_id);
    expect(q.new_since_previous).toBeGreaterThanOrEqual(0);
    expect(recs(q)).not.toContain(cat.ids['r3']);
    await noLeaks(q);

    const end = (
      await call(u, 'POST', '/v1/queue/time-machine/advance', { months: 6 })
    ).json<Queue>();
    expect(end.time_machine?.cutoff).toBe('1908-05-30');
    // The year-only single counts as out once 1907 has ended.
    expect(end.new_since_previous).toBeGreaterThanOrEqual(1);
    const last = await start(u, { cutoff_at: '1907-12-31T12:00:00+09:00' });
    await noLeaks(last);
  });

  it("replaces only suggestions; the listener's choices and history stay", async () => {
    const u = await listener();
    await start(u, { cutoff_at: '1907-06-15T23:59:59+09:00' });
    const chosen = await call(u, 'POST', '/v1/queue/items', {
      items: [{ recording_id: cat.ids['r3'] }],
      placement: 'end',
    });
    expect(chosen.statusCode, chosen.body).toBe(200);
    const q = await start(u, { cutoff_at: '1907-08-01T12:00:00+09:00' });
    // The chosen track stays even though it is not out by the cutoff: it was the listener's.
    expect(q.items.filter((i) => i.origin === 'user').map((i) => i.recording_id)).toEqual([
      cat.ids['r3'],
    ]);
    expect(q.time_machine?.cutoff).toBe('1907-08-01');
  });

  it('hidden mode leaves out what is much played on Rabit now', async () => {
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
    const u = await listener();
    const q = await start(u, { cutoff_at: '1907-06-15T23:59:59+09:00', mode: 'hidden' });
    expect(q.time_machine?.mode).toBe('hidden');
    expect(recs(q)).not.toContain(cat.ids['r1']);
    expect(recs(q)).toContain(cat.ids['r2']);
  });

  it('leaving for the queue or radio clears the cutoff', async () => {
    const u = await listener();
    await start(u, { cutoff_at: '1907-06-15T23:59:59+09:00' });
    const r = await call(u, 'PATCH', '/v1/queue/settings', { mode: 'queue' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Queue>()).toMatchObject({ mode: 'queue', time_machine: null });
    const again = await call(u, 'POST', '/v1/queue/time-machine/advance', {});
    expect(again.statusCode).toBe(409);
  });

  it('validates the cutoff and stays hidden while its flag is off', async () => {
    const u = await listener();
    const bad = async (body: Record<string, unknown>) =>
      (await call(u, 'POST', '/v1/queue/time-machine', body)).statusCode;
    expect(await bad({ cutoff_at: '2999-01-01T00:00:00Z', time_zone: 'UTC' })).toBe(400);
    expect(await bad({ cutoff_at: '1899-12-31T00:00:00Z', time_zone: 'UTC' })).toBe(400);
    expect(await bad({ cutoff_at: '1907-06-15T00:00:00Z', time_zone: 'Mars/Base' })).toBe(400);
    expect(await bad({ cutoff_at: '1907-06-15', time_zone: 'UTC' })).toBe(400);
    expect(
      await bad({ cutoff_at: '1907-06-15T00:00:00Z', time_zone: 'UTC', region_id: 'jp-tokyo' }),
    ).toBe(400);

    await flag(false);
    try {
      expect(await bad({ cutoff_at: '1907-06-15T00:00:00Z', time_zone: 'UTC' })).toBe(404);
      const cov = await call(
        u,
        'GET',
        '/v1/dig/time-machine/coverage?cutoff_at=1907-06-15T00:00:00Z&time_zone=UTC',
      );
      expect(cov.statusCode).toBe(404);
    } finally {
      await flag(true);
    }
  });
});

describe('Time Radio coverage', () => {
  it('counts releases out, too coarse to tell, and playable now', async () => {
    const u = await listener();
    const r = await call(
      u,
      'GET',
      `/v1/dig/time-machine/coverage?cutoff_at=${encodeURIComponent('1907-06-15T23:59:59+09:00')}&time_zone=Asia/Seoul`,
    );
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json<Record<string, number | string | boolean>>();
    expect(c['cutoff']).toBe('1907-06-15');
    expect(c['releases_out']).toBeGreaterThanOrEqual(1);
    expect(c['releases_uncertain']).toBeGreaterThanOrEqual(1);
    expect(c['playable_releases']).toBeGreaterThanOrEqual(1);
  });
});

describe('advanceCutoff', () => {
  const ctx = (cutoff_at: string, time_zone = 'UTC') => ({
    cutoff_at,
    time_zone,
    mode: 'free_explore' as const,
  });
  it('keeps the day, clamped to the end of a shorter month', () => {
    expect(advanceCutoff(ctx('1984-01-31T12:00:00Z'), 1).cutoff_at).toBe(
      '1984-02-29T12:00:00.000Z',
    );
    expect(advanceCutoff(ctx('1983-01-31T12:00:00Z'), 1).cutoff_at).toBe(
      '1983-02-28T12:00:00.000Z',
    );
    expect(advanceCutoff(ctx('1983-11-15T12:00:00Z'), 2).cutoff_at).toBe(
      '1984-01-15T12:00:00.000Z',
    );
  });
  it('lands on the same local day across a daylight-saving change', () => {
    // 23:30 in New York on 1 March (EST); a month later is 1 April (EDT).
    const next = advanceCutoff(ctx('1990-03-02T04:30:00Z', 'America/New_York'), 1);
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
        new Date(next.cutoff_at),
      ),
    ).toBe('1990-04-01');
  });
});
