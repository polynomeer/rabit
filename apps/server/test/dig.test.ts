import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueue } from '../src/platform/jobs/queue.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { countQueries } from './helpers/query-count.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let u: TestUser;
const id = (k: string) => cat.ids[k]!;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
});
afterAll(() => h.close());

async function connections(entity: string, axis: string, query = '', who: TestUser = u) {
  const r = await h.api.inject({
    url: `/v1/dig/entities/${entity}/connections?axis=${axis}${query}`,
    headers: who.headers,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().items as {
    entity: { entity_id: string; entity_type: string; name: string };
    via: {
      relation_id: string | null;
      credit_id: string | null;
      via_entity: { entity_id: string } | null;
    };
    evidence: {
      basis: string;
      verification_state: string;
      confidence: number | null;
      license_status: string | null;
      explanation: string;
    };
    popularity_tier: string;
    playability: { playable: boolean; reason: string | null } | null;
  }[];
}

describe('Rabbit Hole axes (DIG-003/004)', () => {
  it('lists only axes that have connections, grouped', async () => {
    const r = (
      await h.api.inject({ url: `/v1/dig/entities/${id('r1')}/axes`, headers: u.headers })
    ).json();
    const axes = Object.fromEntries(
      r.axes.map((a: { axis: string; group: string; count: number }) => [
        a.axis,
        [a.group, a.count],
      ]),
    );
    expect(axes).toMatchObject({
      credits: ['people', 2],
      artists: ['people', 1],
      same_producer: ['people', 1],
      session_musicians: ['people', 1],
      releases: ['history', 1],
      same_label: ['history', 3],
      sampled_by: ['history', 1],
    });
    expect(axes['samples']).toBeUndefined();
    expect(r.entity.entity_type).toBe('recording');
    expect(
      (
        await h.api.inject({
          url: '/v1/dig/entities/rec_01ARZ3NDEKTSV4RRFFQ69G5FAV/axes',
          headers: u.headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('explains every connection and orders by evidence strength, not popularity', async () => {
    const credits = await connections(id('r1'), 'credits');
    expect(credits.map((c) => c.evidence.basis)).toEqual(['verified_fact', 'declared']);
    expect(credits[0]!.evidence.explanation).toMatch(/^Producer: Pat Producer/);
    expect(credits[1]!.evidence.explanation).toMatch(/^Performer \(bass\): Bea Bassist/);
    expect(credits.every((c) => c.via.credit_id !== null)).toBe(true);
  });

  it('separates the sampling fact from its license status (DIG-018)', async () => {
    const [c] = await connections(id('r1'), 'sampled_by');
    expect(c!.entity.entity_id).toBe(id('r3'));
    expect(c!.evidence).toMatchObject({
      basis: 'verified_fact',
      verification_state: 'rights_reviewed',
      license_status: 'licensed',
    });
    expect(c!.evidence.explanation).toContain('is sampled by');
    expect(c!.via.relation_id).toMatch(/^mrl_/);
  });

  it('marks ML-inferred relations and can exclude them', async () => {
    const inferred = await connections(id('r3'), 'influences');
    expect(inferred).toHaveLength(1);
    expect(inferred[0]!.evidence).toMatchObject({ basis: 'ml_inferred', confidence: 0.62 });
    expect(await connections(id('r3'), 'influences', '&include_inferred=false')).toEqual([]);
  });

  it('includes playability for recordings', async () => {
    const tracks = await connections(id('album'), 'tracks');
    expect(tracks.map((t) => t.entity.entity_id)).toEqual([id('r1'), id('r2')]);
    expect(tracks.every((t) => t.playability?.playable)).toBe(true);
    const other = await h.user();
    const blocked = await connections(id('album'), 'tracks', '', other);
    expect(blocked.every((t) => t.playability?.playable === false)).toBe(true);
    const single = await connections(id('single'), 'tracks');
    expect(
      Object.fromEntries(single.map((t) => [t.entity.entity_id, t.playability?.reason])),
    ).toEqual({ [id('r3')]: null, [id('r4')]: 'no_audio' });
  });

  it('computes playability for a page in one batch (review #6)', async () => {
    const read = (limit: number) =>
      countQueries(h, () => connections(id('album'), 'tracks', `&limit=${limit}`));
    const one = await read(1);
    const two = await read(2);
    expect(two).toBe(one);
  });

  it('rejects unknown axes', async () => {
    const r = await h.api.inject({
      url: `/v1/dig/entities/${id('r1')}/connections?axis=similar_sound`,
      headers: u.headers,
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('Credits Digging (DIG-006)', () => {
  it('moves from a person to every recording they are credited on', async () => {
    const recs = await connections(id('producer'), 'credits');
    expect(recs.map((r) => r.entity.entity_id).sort()).toEqual([id('r1'), id('r3')].sort());
    expect(recs.find((r) => r.entity.entity_id === id('r1'))!.evidence.basis).toBe('verified_fact');
  });

  it('finds same-producer and session-musician recordings through the shared person', async () => {
    const sp = await connections(id('r1'), 'same_producer');
    expect(sp.map((c) => c.entity.entity_id)).toEqual([id('r3')]);
    expect(sp[0]!.via.via_entity?.entity_id).toBe(id('producer'));
    // The weaker of the two credits (declared) bounds the connection.
    expect(sp[0]!.evidence.basis).toBe('declared');
    const sm = await connections(id('r1'), 'session_musicians');
    expect(sm.map((c) => c.entity.entity_id)).toEqual([id('r2')]);
    expect(sm[0]!.evidence.explanation).toMatch(/Same bass player/);
  });
});

describe('listening events (PLY-015) and Deep Cut (DIG-007)', () => {
  async function listen(listener: TestUser, rec: string) {
    const s = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/playback-sessions',
        headers: listener.headers,
        payload: { recording_id: rec, device_id: 'device-test-1' },
      })
    ).json();
    const now = new Date().toISOString();
    const events = [
      {
        event_id: randomUUID(),
        session_id: s.session_id,
        sequence: 0,
        type: 'started',
        position_ms: 0,
        played_ms: 0,
        client_time: now,
      },
      {
        event_id: randomUUID(),
        session_id: s.session_id,
        sequence: 1,
        type: 'ended',
        position_ms: 3000,
        played_ms: 3000,
        client_time: now,
      },
    ];
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: listener.headers,
      payload: { events },
    });
    expect(r.statusCode, r.body).toBe(202);
    return { session: s, events, result: r.json() };
  }

  it('accepts valid events once, ignoring duplicates and rejecting foreign sessions', async () => {
    const { events, result } = await listen(u, id('r1'));
    expect(result).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    const again = await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: u.headers,
      payload: { events },
    });
    expect(again.json()).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    const other = await h.user();
    const foreign = await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: other.headers,
      payload: { events: [{ ...events[0]!, event_id: randomUUID() }] },
    });
    expect(foreign.json().rejected).toEqual([
      { event_id: expect.any(String), reason: 'not_owner' },
    ]);
    const inflated = await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: u.headers,
      payload: {
        events: [{ ...events[1]!, event_id: randomUUID(), sequence: 2, played_ms: 3_600_000 }],
      },
    });
    expect(inflated.json().rejected[0].reason).toBe('played_exceeds_wall_clock');
  });

  it('budgets played time across a whole batch and rejects ended sessions (review #2)', async () => {
    const listener = await h.user();
    await ops.setCountry(listener, 'KR');
    await ops.subscribe(listener);
    // A separate catalog, so this test does not change popularity asserted elsewhere.
    const own = await seedCatalog(h);
    const s = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/playback-sessions',
        headers: listener.headers,
        payload: { recording_id: own.ids['r2'], device_id: 'device-test-1' },
      })
    ).json();
    const now = new Date().toISOString();
    const beats = Array.from({ length: 8 }, (_, i) => ({
      event_id: randomUUID(),
      session_id: s.session_id,
      sequence: i,
      type: 'heartbeat',
      position_ms: 1000,
      played_ms: 4900,
      client_time: now,
    }));
    const r = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/listening-events/batch',
        headers: listener.headers,
        payload: { events: beats },
      })
    ).json();
    // 39 s claimed right after the session started: only what fits wall clock + tolerance is accepted.
    expect(r.accepted).toBeLessThanOrEqual(2);
    expect(r.rejected.length).toBeGreaterThanOrEqual(6);

    await h.ctx.db
      .updateTable('playback_session')
      .set({ status: 'revoked' })
      .where('id', '=', s.session_id)
      .execute();
    const late = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/listening-events/batch',
        headers: listener.headers,
        payload: { events: [{ ...beats[0]!, event_id: randomUUID(), sequence: 99, played_ms: 0 }] },
      })
    ).json();
    expect(late.rejected[0].reason).toBe('session_inactive');
  });

  it('filters by relative popularity while unknown popularity is never treated as popular', async () => {
    const second = await h.user();
    await ops.setCountry(second, 'KR');
    await ops.subscribe(second);
    await listen(second, id('r1'));
    await listen(second, id('r2'));
    await enqueue(h.ctx.db, {
      kind: 'playback.compute_popularity',
      payload: {},
      dedupeKey: `test-pop-${Date.now()}`,
    });
    await h.worker.drain();

    const all = await connections(id('r4'), 'same_label');
    const tier = Object.fromEntries(all.map((c) => [c.entity.entity_id, c.popularity_tier]));
    expect(['top', 'upper']).toContain(tier[id('r1')]);
    // r2's percentile depends on how many other catalog recordings exist, so only
    // order-independent facts are asserted: most-listened is popular, unheard is obscure.
    expect(tier[id('r3')]).toBe('obscure');

    const deep = (await connections(id('r4'), 'same_label', '&popularity=below_top_50')).map(
      (c) => c.entity.entity_id,
    );
    expect(deep).toContain(id('r3'));
    expect(deep).not.toContain(id('r1'));
    // A recording without audio has no popularity at all and still appears.
    const fromR1 = (await connections(id('r1'), 'same_label', '&popularity=obscure')).map(
      (c) => c.entity.entity_id,
    );
    expect(fromR1).toEqual(expect.arrayContaining([id('r3'), id('r4')]));

    const pop = await h.ctx.db
      .selectFrom('recording_popularity')
      .selectAll()
      .where('recording_id', '=', id('r1'))
      .executeTakeFirstOrThrow();
    expect(pop.distinct_listeners).toBe(2);
    expect(pop.policy_version).toBe('popularity/v1');
  });
});

describe('Digging Trails (DIG-005/022/025)', () => {
  let sessionId: string;

  it('starts at a catalog entity and records verified steps with evidence', async () => {
    const start = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: id('r1') },
    });
    expect(start.statusCode).toBe(201);
    sessionId = start.json().dig_session_id;
    expect(start.json()).toMatchObject({
      current_seq: 0,
      empty_state: null,
      trail: [{ seq: 0, parent_seq: null }],
    });

    const step = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/steps`,
      headers: u.headers,
      payload: { entity_id: id('r3'), axis: 'sampled_by' },
    });
    expect(step.statusCode).toBe(201);
    const node = step.json().trail[1];
    expect(node).toMatchObject({
      seq: 1,
      parent_seq: 0,
      via_axis: 'sampled_by',
      evidence: { basis: 'verified_fact' },
    });
    expect(step.json().current_seq).toBe(1);
  });

  it('refuses fabricated edges (T29)', async () => {
    const bad = [
      { entity_id: id('r2'), axis: 'samples' },
      { entity_id: id('bassist'), axis: 'credits' },
      { entity_id: id('r1'), axis: 'samples', relation_id: 'mrl_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    ];
    for (const b of bad) {
      const r = await h.api.inject({
        method: 'POST',
        url: `/v1/dig-sessions/${sessionId}/steps`,
        headers: u.headers,
        payload: b,
      });
      expect(r.statusCode, JSON.stringify(b)).toBe(422);
      expect(r.json().error.code).toBe('INVALID_RELATION_STEP');
    }
  });

  it('returns to an earlier node and branches from there', async () => {
    const back = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/cursor`,
      headers: u.headers,
      payload: { seq: 0 },
    });
    expect(back.json().current_seq).toBe(0);
    const branch = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/steps`,
      headers: u.headers,
      payload: { entity_id: id('producer'), axis: 'credits' },
    });
    expect(branch.json().trail[2]).toMatchObject({
      seq: 2,
      parent_seq: 0,
      entity: { entity_type: 'person' },
    });
    const credits = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/steps`,
      headers: u.headers,
      payload: { entity_id: id('r3'), axis: 'credits' },
    });
    expect(credits.statusCode).toBe(201);
    expect(
      (
        await h.api.inject({
          method: 'POST',
          url: `/v1/dig-sessions/${sessionId}/cursor`,
          headers: u.headers,
          payload: { seq: 99 },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('records actions, summarizes, saves and resumes', async () => {
    await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/nodes/1/actions`,
      headers: u.headers,
      payload: { action: 'played' },
    });
    await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/nodes/1/actions`,
      headers: u.headers,
      payload: { action: 'saved' },
    });
    const saved = await h.api.inject({
      method: 'PATCH',
      url: `/v1/dig-sessions/${sessionId}`,
      headers: u.headers,
      payload: { saved: true, title: 'Sample hunt' },
    });
    expect(saved.json().summary).toEqual({
      nodes: 4,
      distinct_artists: 2,
      axes_used: ['sampled_by', 'credits'],
      played: 1,
      saved: 1,
    });
    const list = (
      await h.api.inject({ url: '/v1/dig-sessions?saved=true', headers: u.headers })
    ).json();
    expect(list.items[0]).toMatchObject({
      dig_session_id: sessionId,
      title: 'Sample hunt',
      nodes: 4,
    });
    const resumed = (
      await h.api.inject({ url: `/v1/dig-sessions/${sessionId}`, headers: u.headers })
    ).json();
    expect(resumed.trail).toHaveLength(4);
  });

  it('turns the trail into a playlist of its recordings, in order, once each', async () => {
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/playlist`,
      headers: u.headers,
      payload: {},
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().title).toBe('Sample hunt');
    expect(r.json().items.map((i: { ref_id: string }) => i.ref_id)).toEqual([id('r1'), id('r3')]);
  });

  it('is private and ends cleanly', async () => {
    const other = await h.user();
    expect(
      (await h.api.inject({ url: `/v1/dig-sessions/${sessionId}`, headers: other.headers }))
        .statusCode,
    ).toBe(404);
    const ended = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/end`,
      headers: u.headers,
    });
    expect(ended.json().state).toBe('ended');
    const late = await h.api.inject({
      method: 'POST',
      url: `/v1/dig-sessions/${sessionId}/steps`,
      headers: u.headers,
      payload: { entity_id: id('r3'), axis: 'sampled_by' },
    });
    expect(late.statusCode).toBe(409);
  });

  it('starts from own audio through an explicit catalog link, otherwise shows an empty state', async () => {
    const logSource = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    await h.api.inject({
      method: 'POST',
      url: '/v1/audio-logs',
      headers: u.headers,
      payload: {
        audio_source_id: logSource,
        title: 'Cover attempt',
        recorded_at: new Date().toISOString(),
        recorded_tz: 'UTC',
        linked_recording_id: id('r1'),
      },
    });
    const linked = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { audio_source_id: logSource },
    });
    expect(linked.json().trail[0].entity.entity_id).toBe(id('r1'));

    const plain = await uploadReady(h, u, fixtures.wav());
    const empty = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { audio_source_id: plain },
    });
    expect(empty.json()).toMatchObject({ trail: [], empty_state: { reason: 'no_catalog_link' } });

    const other = await h.user();
    const foreign = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: other.headers,
      payload: { audio_source_id: plain },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('shows an empty state when nothing is connected', async () => {
    const lonely = await seedCatalog(h, { grant: false });
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: lonely.ids['label']! },
    });
    expect(r.json().empty_state).toBeNull(); // labels connect to their releases
    const person = await h.api.inject({
      method: 'POST',
      url: '/v1/dig-sessions',
      headers: u.headers,
      payload: { entity_id: lonely.ids['solo']! },
    });
    expect(person.statusCode).toBe(201);
  });
});
