import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_GROUP, rate, weeklyRetention } from '../src/modules/ops/alpha-metrics.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

/** Alpha validation metrics (ADR-0032): cohort aggregates only, small groups withheld. */
let h: Harness;
let op: TestUser;
let people: TestUser[];

// A sign-up day no other test uses, so the cohort holds only this file's people.
const SIGNUP = '2020-01-10';
const LONE = '2020-03-01';
const at = (day: string) => new Date(`${day}T03:00:00Z`); // noon in Korea

async function backdateUser(u: TestUser, day: string) {
  await sql`UPDATE app_user SET created_at = ${at(day)} WHERE id = ${u.userId}`.execute(h.ctx.db);
}

async function addRecords(u: TestUser, count: number, day: string) {
  for (let i = 0; i < count; i += 1) {
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/physical-items',
      headers: u.headers,
      payload: { format: 'cd', title: `Record ${i}` },
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  await sql`UPDATE physical_item SET created_at = ${at(day)} WHERE user_id = ${u.userId}`.execute(
    h.ctx.db,
  );
}

const metrics = (from: string, to: string, who: TestUser = op) =>
  h.api.inject({ url: `/v1/ops/metrics/alpha?from=${from}&to=${to}`, headers: who.headers });

beforeAll(async () => {
  h = await createHarness();
  op = await h.user({ operator: true });
  const catalog = await seedCatalog(h, { grant: true });
  people = [];
  for (let i = 0; i < 6; i += 1) people.push(await h.user());
  const [mixer, second, third, collector] = people as [TestUser, TestUser, TestUser, TestUser];

  // One person mixes a catalog recording with their own upload, and plays the upload.
  const own = await uploadReady(h, mixer, fixtures.wav());
  const play = await h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: mixer.headers,
    payload: { audio_source_id: own, device_id: 'device-alpha' },
  });
  expect(play.statusCode, play.body).toBe(201);
  const pl = await h.api.inject({
    method: 'POST',
    url: '/v1/playlists',
    headers: mixer.headers,
    payload: { title: 'mixed' },
  });
  const playlistId = pl.json<{ playlist_id: string }>().playlist_id;
  let version = 1;
  const recordingId = catalog.ids['r1'];
  for (const item of [
    { ref_type: 'recording', ref_id: recordingId },
    { ref_type: 'audio_source', ref_id: own },
  ]) {
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${playlistId}/items`,
      headers: { ...mixer.headers, 'if-match': `"${version}"` },
      payload: item,
    });
    expect(r.statusCode, r.body).toBe(201);
    version += 1;
  }

  // Three people are back in week 4 (days 21–27), one collector only in week 1.
  for (const u of [mixer, second, third]) await addRecords(u, 1, '2020-02-02');
  await addRecords(collector, 20, '2020-01-11');

  for (const u of people) await backdateUser(u, SIGNUP);
  const lone = await h.user();
  await backdateUser(lone, LONE);
});
afterAll(async () => {
  await h.close();
});

describe('alpha validation metrics', () => {
  it('reports gate C over the cohort, as counts and rates only', async () => {
    const r = await metrics(SIGNUP, SIGNUP);
    expect(r.statusCode, r.body).toBe(200);
    const m = r.json();
    expect(m.cohort).toEqual({ from: SIGNUP, to: SIGNUP, people: 6 });
    expect(m.min_group).toBe(MIN_GROUP);

    const week = (k: number) => m.retention.find((w: { week: number }) => w.week === k);
    expect(week(1)).toMatchObject({ count: 1, of: 6, rate: 0.167 });
    expect(week(4)).toMatchObject({ count: 3, of: 6, rate: 0.5 });
    expect(week(8)).toMatchObject({ count: 0, of: 6, rate: 0 });

    expect(m.mixed_library).toEqual({
      playlist_mixers: rate(1, 6),
      own_audio_players: rate(1, 6),
    });
    expect(m.collection).toEqual({
      collectors: rate(4, 6),
      collectors_20_plus: rate(1, 6),
    });
    // Nobody dug: no sessions, so the kept share is withheld.
    expect(m.digging.diggers).toEqual(rate(0, 6));
    expect(m.digging.kept_sessions).toEqual({ count: null, of: 0, rate: null, suppressed: true });

    // Nothing names a person.
    const body = r.body;
    for (const u of people) expect(body).not.toContain(u.userId);
  });

  it('withholds every rate when the cohort is smaller than the minimum group', async () => {
    const m = (await metrics(LONE, LONE)).json();
    expect(m.cohort.people).toBe(1);
    expect(m.collection.collectors).toEqual({ count: null, of: 1, rate: null, suppressed: true });
    expect(m.retention.every((w: { suppressed: boolean }) => w.suppressed)).toBe(true);
  });

  it('is for operators only, and every view is audited', async () => {
    expect((await metrics(SIGNUP, SIGNUP, people[0])).statusCode).toBe(403);
    const before = await h.ctx.db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('action', '=', 'ops.alpha_metrics_viewed')
      .where('actor_id', '=', op.userId)
      .executeTakeFirstOrThrow();
    await metrics(SIGNUP, SIGNUP);
    const after = await h.ctx.db
      .selectFrom('audit_log')
      .select(['subject_id'])
      .where('action', '=', 'ops.alpha_metrics_viewed')
      .where('actor_id', '=', op.userId)
      .execute();
    expect(after.length).toBe(before.n + 1);
    expect(after.at(-1)?.subject_id).toBe(`${SIGNUP}..${SIGNUP}`);
  });

  it('rejects a reversed or overlong cohort', async () => {
    expect((await metrics('2020-02-01', '2020-01-01')).statusCode).toBe(400);
    expect((await metrics('2020-01-01', '2021-06-01')).statusCode).toBe(400);
    expect((await metrics('2020-1-1', '2020-01-02')).statusCode).toBe(400);
  });
});

describe('weekly retention', () => {
  const cohort = Array.from({ length: 5 }, (_, i) => ({
    userId: `u${i}`,
    signupDay: '2026-01-01',
  }));

  it('counts a week only for people whose week is over', () => {
    const active = new Map([['u0', new Set(['2026-01-08'])]]);
    // On day 10, week 1 (days 0–6) is over and week 2 (days 7–13) is not.
    const weeks = weeklyRetention(cohort, active, '2026-01-11', 2);
    expect(weeks[0]).toMatchObject({ week: 1, count: 0, of: 5 });
    expect(weeks[1]).toMatchObject({ week: 2, of: 0, suppressed: true });
  });

  it('places days on the boundary in the right week', () => {
    const active = new Map([
      ['u0', new Set(['2026-01-07'])], // day 6: week 1
      ['u1', new Set(['2026-01-08'])], // day 7: week 2
    ]);
    const [w1, w2] = weeklyRetention(cohort, active, '2026-03-01', 2);
    expect(w1).toMatchObject({ count: 1, of: 5 });
    expect(w2).toMatchObject({ count: 1, of: 5 });
  });
});
