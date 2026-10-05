import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from './helpers/audio-fixtures.js';
import { seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user();
  bob = await h.user();
});
afterAll(() => h.close());

async function createLog(u: TestUser, sourceId: string, extra: Record<string, unknown> = {}) {
  return h.api.inject({
    method: 'POST',
    url: '/v1/audio-logs',
    headers: u.headers,
    payload: {
      audio_source_id: sourceId,
      title: 'Morning idea',
      recorded_at: '2026-10-03T22:15:00Z',
      recorded_tz: 'Asia/Seoul',
      tags: ['idea', 'melody', 'idea'],
      ...extra,
    },
  });
}

describe('Audio Log (LOG-001..009)', () => {
  let sourceId: string;
  let logId: string;

  beforeAll(async () => {
    sourceId = await uploadReady(h, alice, fixtures.wav(), {
      intent: 'audio_log',
      filename: 'rec-001.wav',
    });
  });

  it('is an AudioObject of kind audio_log, private by default', async () => {
    const s = (
      await h.api.inject({ url: `/v1/audio-sources/${sourceId}`, headers: alice.headers })
    ).json();
    expect(s).toMatchObject({
      kind: 'audio_log',
      origin: 'audio_log',
      visibility: 'private',
      status: 'ready',
    });
  });

  it('creates metadata with UTC time plus the local time zone', async () => {
    const res = await createLog(alice, sourceId, { note: 'hummed on the way home' });
    expect(res.statusCode).toBe(201);
    const log = res.json();
    logId = log.audio_log_id;
    expect(log).toMatchObject({
      audio_source_id: sourceId,
      title: 'Morning idea',
      note: 'hummed on the way home',
      recorded_at: '2026-10-03T22:15:00.000Z',
      recorded_tz: 'Asia/Seoul',
      tags: ['idea', 'melody'],
      linked_recording_id: null,
      source_status: 'ready',
    });
    const s = (
      await h.api.inject({ url: `/v1/audio-sources/${sourceId}`, headers: alice.headers })
    ).json();
    expect(s.title).toBe('Morning idea');
  });

  it('allows only one log per source', async () => {
    const res = await createLog(alice, sourceId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_EXISTS');
  });

  it('plays through the same playback path as any other audio', async () => {
    const res = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: alice.headers,
      payload: { audio_source_id: sourceId, device_id: 'device-test-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('audio_log');
  });

  it('validates input', async () => {
    const other = await uploadReady(h, alice, fixtures.wav(), { intent: 'audio_log' });
    expect((await createLog(alice, other, { recorded_tz: 'Mars/Olympus' })).statusCode).toBe(400);
    expect((await createLog(alice, other, { recorded_at: 'yesterday' })).statusCode).toBe(400);
    expect((await createLog(alice, other, { visibility: 'public' })).statusCode).toBe(400);
    const link = await createLog(alice, other, {
      linked_recording_id: 'rec_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    expect(link.statusCode).toBe(422);
  });

  it('only attaches to audio uploaded as an Audio Log', async () => {
    const plain = await uploadReady(h, alice, fixtures.wav());
    expect((await createLog(alice, plain)).statusCode).toBe(422);
  });

  it("hides other users' logs and sources", async () => {
    expect((await createLog(bob, sourceId)).statusCode).toBe(404);
    expect(
      (await h.api.inject({ url: `/v1/audio-logs/${logId}`, headers: bob.headers })).statusCode,
    ).toBe(404);
    const patch = await h.api.inject({
      method: 'PATCH',
      url: `/v1/audio-logs/${logId}`,
      headers: bob.headers,
      payload: { title: 'hijack' },
    });
    expect(patch.statusCode).toBe(404);
    const list = (await h.api.inject({ url: '/v1/audio-logs', headers: bob.headers })).json();
    expect(list.items).toEqual([]);
  });

  it('corrects date and metadata without touching the audio version', async () => {
    const before = (
      await h.api.inject({ url: `/v1/audio-sources/${sourceId}`, headers: alice.headers })
    ).json();
    const res = await h.api.inject({
      method: 'PATCH',
      url: `/v1/audio-logs/${logId}`,
      headers: alice.headers,
      payload: { recorded_at: '2026-10-02T10:00:00+09:00', note: null, title: 'Fixed title' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      recorded_at: '2026-10-02T01:00:00.000Z',
      note: null,
      title: 'Fixed title',
    });
    const after = (
      await h.api.inject({ url: `/v1/audio-sources/${sourceId}`, headers: alice.headers })
    ).json();
    expect(after.version_id).toBe(before.version_id);
    expect(
      (
        await h.api.inject({
          method: 'PATCH',
          url: `/v1/audio-logs/${logId}`,
          headers: alice.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });

  it('lists logs by recorded time with signed cursors', async () => {
    const u = await h.user();
    const times = ['2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z'];
    for (const t of times) {
      const id = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
      expect((await createLog(u, id, { recorded_at: t, title: t })).statusCode).toBe(201);
    }
    const p1 = (await h.api.inject({ url: '/v1/audio-logs?limit=2', headers: u.headers })).json();
    expect(p1.items.map((i: { title: string }) => i.title)).toEqual([times[1], times[2]]);
    const p2 = (
      await h.api.inject({
        url: `/v1/audio-logs?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
        headers: u.headers,
      })
    ).json();
    expect(p2.items.map((i: { title: string }) => i.title)).toEqual([times[0]]);
    expect(p2.next_cursor).toBeNull();
    const stolen = await h.api.inject({
      url: `/v1/audio-logs?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
      headers: alice.headers,
    });
    expect(stolen.statusCode).toBe(400);
  });

  it('removes the metadata when the audio is deleted', async () => {
    const id = await uploadReady(h, alice, fixtures.wav(), { intent: 'audio_log' });
    const log = (await createLog(alice, id)).json();
    await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${id}`,
      headers: alice.headers,
    });
    expect(
      (await h.api.inject({ url: `/v1/audio-logs/${log.audio_log_id}`, headers: alice.headers }))
        .statusCode,
    ).toBe(404);
    await h.worker.drain();
    const rows = await h.ctx.db
      .selectFrom('audio_log')
      .select('id')
      .where('audio_source_id', '=', id)
      .execute();
    expect(rows).toEqual([]);
  });
});

describe('deletion racing an Audio Log write (review #5)', () => {
  let recordingId: string;
  beforeAll(async () => {
    recordingId = (await seedCatalog(h)).ids['r1']!;
  });

  /**
   * Runs `write` so that it has passed its read check and is paused before its
   * write transaction, while the real deletion request commits and the deletion
   * job runs to completion; then lets the write continue. The pause needs no
   * hook in the code: the write's link check reads `recording`, which this test
   * locks; deletion never touches that table.
   */
  async function raceDeletion(
    u: TestUser,
    sourceId: string,
    write: () => Promise<{ statusCode: number }>,
  ) {
    let response: Promise<{ statusCode: number }> | undefined;
    await h.ctx.db.transaction().execute(async (lock) => {
      await sql`LOCK TABLE recording IN ACCESS EXCLUSIVE MODE`.execute(lock);
      response = write();
      // Deterministic: wait until the write is blocked on the lock, not a sleep.
      await expect
        .poll(async () => {
          const r = await sql<{ n: number }>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%from "recording"%'`.execute(h.ctx.db);
          return r.rows[0]?.n;
        })
        .toBe(1);
      const del = await h.api.inject({
        method: 'DELETE',
        url: `/v1/audio-sources/${sourceId}`,
        headers: u.headers,
      });
      expect(del.statusCode).toBe(202);
      await h.worker.drain();
      const gone = await h.ctx.db
        .selectFrom('audio_source')
        .select('status')
        .where('id', '=', sourceId)
        .executeTakeFirstOrThrow();
      expect(gone.status).toBe('deleted');
    });
    return (await response!).statusCode;
  }

  async function personalTextLeft(sourceId: string, canary: string) {
    const logs = await h.ctx.db
      .selectFrom('audio_log')
      .selectAll()
      .where('audio_source_id', '=', sourceId)
      .execute();
    const src = await h.ctx.db
      .selectFrom('audio_source')
      .select('title')
      .where('id', '=', sourceId)
      .executeTakeFirstOrThrow();
    return JSON.stringify({ logs, title: src.title }).includes(canary);
  }

  it('does not write a new Audio Log for audio deleted during the request', async () => {
    const u = await h.user();
    const sourceId = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    const canary = `CANARY-create-${sourceId.slice(-6)}`;
    const status = await raceDeletion(u, sourceId, () =>
      createLog(u, sourceId, { title: canary, note: canary, linked_recording_id: recordingId }),
    );
    expect(status).toBe(404);
    expect(await personalTextLeft(sourceId, canary)).toBe(false);
  });

  it('does not write edited Audio Log text back after the deletion job removed it', async () => {
    const u = await h.user();
    const sourceId = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    const log = (await createLog(u, sourceId)).json<{ audio_log_id: string }>();
    const canary = `CANARY-update-${sourceId.slice(-6)}`;
    const status = await raceDeletion(u, sourceId, () =>
      h.api.inject({
        method: 'PATCH',
        url: `/v1/audio-logs/${log.audio_log_id}`,
        headers: u.headers,
        payload: { title: canary, note: canary, linked_recording_id: recordingId },
      }),
    );
    expect(status).toBe(404);
    expect(await personalTextLeft(sourceId, canary)).toBe(false);
  });
});
