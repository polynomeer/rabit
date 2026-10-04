import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaTokenCodec } from '../src/platform/media-token.js';
import { BUCKETS } from '../src/platform/storage/blob-store.js';
import { fixtures } from './helpers/audio-fixtures.js';
import {
  createHarness,
  mediaPath,
  sha256Hex,
  uploadBytes,
  uploadReady,
  type Harness,
  type TestUser,
} from './helpers/harness.js';

let h: Harness;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user();
  bob = await h.user();
});
afterAll(() => h.close());

async function play(u: TestUser, sourceId: string) {
  return h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { audio_source_id: sourceId, device_id: 'device-test-1' },
  });
}

describe('private audio: happy path (upload → process → library → playback)', () => {
  let sourceId: string;

  it('uploads, processes and lists a WAV', async () => {
    const { audioSourceId, finalize } = await uploadBytes(h, alice, fixtures.wav(), {
      filename: 'My take.wav',
    });
    expect(finalize).toMatchObject({ state: 'quarantined', audio_source_id: audioSourceId });
    const processing = await h.api.inject({
      url: `/v1/audio-sources/${audioSourceId}`,
      headers: alice.headers,
    });
    expect(processing.json()).toMatchObject({
      status: 'processing',
      capabilities: { play: false },
    });

    await h.worker.drain();
    sourceId = audioSourceId;

    const res = await h.api.inject({
      url: `/v1/audio-sources/${sourceId}`,
      headers: alice.headers,
    });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({
      status: 'ready',
      kind: 'private_audio',
      origin: 'private_upload',
      visibility: 'private',
      title: 'My take',
      capabilities: { play: true, download_export: true, publish: false },
      technical: { sample_rate: 44100, channels: 2, codec: 'pcm_s16le' },
    });
    expect(s.duration_ms).toBeGreaterThan(2900);
    expect(s.duration_ms).toBeLessThan(3100);
    expect(typeof s.technical.integrated_lufs).toBe('number');

    const list = await h.api.inject({ url: '/v1/audio-sources', headers: alice.headers });
    expect(list.json().items.map((i: { audio_source_id: string }) => i.audio_source_id)).toContain(
      sourceId,
    );

    const upload = await h.ctx.db
      .selectFrom('upload_session')
      .select(['state', 'quarantine_key'])
      .where('audio_source_id', '=', sourceId)
      .executeTakeFirstOrThrow();
    expect(upload.state).toBe('ready');
    expect(await h.ctx.blobs.head(BUCKETS.quarantine, upload.quarantine_key)).toBeNull();
  });

  it('stores the original in the private namespace with its checksum', async () => {
    const assets = await h.ctx.db
      .selectFrom('audio_asset')
      .selectAll()
      .where('audio_source_id', '=', sourceId)
      .execute();
    const kinds = assets.map((a) => a.kind).sort();
    expect(kinds).toEqual(['hls', 'original', 'waveform']);
    const original = assets.find((a) => a.kind === 'original')!;
    expect(original.bucket).toBe(BUCKETS.privateOriginals);
    expect(original.sha256).toBe(sha256Hex(fixtures.wav()));
    expect(assets.every((a) => a.bucket.startsWith('rabit-private-'))).toBe(true);
  });

  it('returns a waveform', async () => {
    const res = await h.api.inject({
      url: `/v1/audio-sources/${sourceId}/waveform`,
      headers: alice.headers,
    });
    expect(res.statusCode).toBe(200);
    const w = res.json();
    expect(w.peaks.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...w.peaks)).toBeGreaterThan(0.05); // lavfi sine amplitude is 1/8
    expect(Math.max(...w.peaks)).toBeLessThanOrEqual(1);
  });

  it('reports storage usage on /v1/me', async () => {
    const me = (await h.api.inject({ url: '/v1/me', headers: alice.headers })).json();
    expect(me.quota.used_bytes).toBeGreaterThanOrEqual(fixtures.wav().length);
    expect(me.subscription_state).toBe('none');
  });

  it('issues a playback session and serves the HLS package through the media gateway', async () => {
    const res = await play(alice, sourceId);
    expect(res.statusCode).toBe(201);
    const session = res.json();
    expect(session).toMatchObject({
      source: 'private_upload',
      quality: { codec: 'aac', lossless: false, provisional: true },
      capabilities: { seek: true, offline: false, stems: false, transform: false },
    });
    expect(new Date(session.media_token_expires_at).getTime() - Date.now()).toBeLessThanOrEqual(
      60_000,
    );

    const manifest = await h.media.inject({ url: mediaPath(session.manifest_url) });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toContain('mpegurl');
    expect(manifest.body).toContain('#EXT-X-MAP:URI="init.mp4"');
    const segment = /seg_\d{5}\.m4s/.exec(manifest.body)![0];
    const base = mediaPath(session.manifest_url).replace(/index\.m3u8$/, '');
    for (const f of ['init.mp4', segment]) {
      const r = await h.media.inject({ url: `${base}${f}` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('audio/mp4');
      expect(r.rawPayload.length).toBeGreaterThan(100);
    }
  });

  it('accepts FLAC and MP3', async () => {
    for (const buf of [fixtures.flac(), fixtures.mp3()]) {
      const id = await uploadReady(h, alice, buf);
      const s = (
        await h.api.inject({ url: `/v1/audio-sources/${id}`, headers: alice.headers })
      ).json();
      expect(s.status).toBe('ready');
    }
  });

  it('renames a source', async () => {
    const res = await h.api.inject({
      method: 'PATCH',
      url: `/v1/audio-sources/${sourceId}`,
      headers: alice.headers,
      payload: { title: 'Renamed' },
    });
    expect(res.json().title).toBe('Renamed');
  });
});

describe('private audio: unauthorized access (T04, T05)', () => {
  let sourceId: string;
  let uploadId: string;
  beforeAll(async () => {
    sourceId = await uploadReady(h, alice, fixtures.wav());
    const pending = await h.api.inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: alice.headers,
      payload: { intent: 'private_upload', size_bytes: 10, sha256: sha256Hex(Buffer.alloc(10)) },
    });
    uploadId = pending.json().upload.upload_id;
  });

  it('rejects requests without a valid token', async () => {
    expect((await h.api.inject({ url: '/v1/audio-sources' })).statusCode).toBe(401);
    const bad = await h.api.inject({
      url: '/v1/audio-sources',
      headers: { authorization: 'Bearer nope' },
    });
    expect(bad.statusCode).toBe(401);
    const expired = await h.issuer.issue({ subject: alice.subject, expired: true });
    expect(
      (await h.api.inject({ url: '/v1/me', headers: { authorization: `Bearer ${expired}` } }))
        .statusCode,
    ).toBe(401);
    const wrongAud = await h.issuer.issue({ subject: alice.subject, audience: 'other-api' });
    expect(
      (await h.api.inject({ url: '/v1/me', headers: { authorization: `Bearer ${wrongAud}` } }))
        .statusCode,
    ).toBe(401);
  });

  it('requires a verified email', async () => {
    const t = await h.issuer.issue({ subject: 'unverified-1', emailVerified: false });
    expect(
      (await h.api.inject({ url: '/v1/me', headers: { authorization: `Bearer ${t}` } })).statusCode,
    ).toBe(403);
  });

  it("returns 404 for every way of reaching another user's source", async () => {
    const missing = 'asr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const attempts = [
      { method: 'GET' as const, url: `/v1/audio-sources/${sourceId}` },
      { method: 'PATCH' as const, url: `/v1/audio-sources/${sourceId}`, payload: { title: 'x' } },
      { method: 'DELETE' as const, url: `/v1/audio-sources/${sourceId}` },
      { method: 'GET' as const, url: `/v1/audio-sources/${sourceId}/waveform` },
      { method: 'GET' as const, url: `/v1/uploads/${uploadId}` },
      { method: 'DELETE' as const, url: `/v1/uploads/${uploadId}` },
    ];
    for (const a of attempts) {
      const res = await h.api.inject({
        ...a,
        headers: { ...bob.headers, 'idempotency-key': 'k-12345678' },
      });
      expect(res.statusCode, `${a.method} ${a.url}`).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    const fin = await h.api.inject({
      method: 'POST',
      url: `/v1/uploads/${uploadId}/finalize`,
      headers: { ...bob.headers, 'idempotency-key': 'k-12345678' },
    });
    expect(fin.statusCode).toBe(404);
    // Same response as a non-existent id: existence is not revealed.
    const playOther = await play(bob, sourceId);
    const playMissing = await play(bob, missing);
    expect(playOther.statusCode).toBe(404);
    expect(playOther.json().error.code).toBe(playMissing.json().error.code);
  });

  it("never lists another user's sources", async () => {
    const list = await h.api.inject({ url: '/v1/audio-sources?limit=100', headers: bob.headers });
    expect(
      list.json().items.map((i: { audio_source_id: string }) => i.audio_source_id),
    ).not.toContain(sourceId);
  });

  it('rejects client-supplied ownership fields', async () => {
    const res = await h.api.inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: bob.headers,
      payload: {
        intent: 'private_upload',
        size_bytes: 10,
        sha256: sha256Hex(Buffer.alloc(10)),
        workspace_id: alice.workspaceId,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not reveal that another account has the same file (T06)', async () => {
    const id = await uploadReady(h, bob, fixtures.wav());
    expect(id).not.toBe(sourceId);
    const assets = await h.ctx.db
      .selectFrom('audio_asset')
      .select(['object_key'])
      .where('audio_source_id', 'in', [id, sourceId])
      .where('kind', '=', 'original')
      .execute();
    expect(new Set(assets.map((a) => a.object_key)).size).toBe(2);
  });
});

describe('private audio: malformed media (T09)', () => {
  const cases: [string, () => Buffer, string][] = [
    ['random bytes', fixtures.random, 'UNSUPPORTED_MEDIA'],
    ['text renamed to wav', fixtures.text, 'UNSUPPORTED_MEDIA'],
    ['RIFF header with garbage', fixtures.fakeWav, 'CORRUPT_MEDIA'],
    ['video-only mp4', fixtures.videoOnly, 'UNSUPPORTED_MEDIA'],
  ];
  for (const [name, make, code] of cases) {
    it(`fails "${name}" permanently, releases quota and removes the quarantined object`, async () => {
      const u = await h.user();
      const { audioSourceId, uploadId } = await uploadBytes(h, u, make());
      await h.worker.drain();
      const s = (
        await h.api.inject({ url: `/v1/audio-sources/${audioSourceId}`, headers: u.headers })
      ).json();
      expect(s.status).toBe('failed');
      expect(s.failure_code).toBe(code);
      const up = (
        await h.api.inject({ url: `/v1/uploads/${uploadId}`, headers: u.headers })
      ).json();
      expect(up).toMatchObject({ state: 'failed', failure_code: code });
      const me = (await h.api.inject({ url: '/v1/me', headers: u.headers })).json();
      expect(me.quota.reserved_bytes).toBe(0);
      expect(me.quota.used_bytes).toBe(0);
      const job = await h.ctx.db
        .selectFrom('job')
        .select(['status', 'attempts'])
        .where('kind', '=', 'audio.process')
        .where('payload', '@>', JSON.stringify({ audio_source_id: audioSourceId }) as never)
        .executeTakeFirstOrThrow();
      expect(job).toEqual({ status: 'dead', attempts: 1 });
      expect((await play(u, audioSourceId)).statusCode).toBe(409);
    });
  }

  it('rejects files over the duration cap', async () => {
    const small = await createHarness({ QUOTA_FREE_MAX_DURATION_MS: '5000' });
    try {
      const u = await small.user();
      const { audioSourceId } = await uploadBytes(small, u, fixtures.longWav());
      await small.worker.drain();
      const s = (
        await small.api.inject({ url: `/v1/audio-sources/${audioSourceId}`, headers: u.headers })
      ).json();
      expect(s.failure_code).toBe('DURATION_EXCEEDED');
    } finally {
      await small.close();
    }
  });
});

describe('private audio: uploads, quota and finalize idempotency (AC-01)', () => {
  it('replays a duplicate finalize with the same key and rejects a different key', async () => {
    const u = await h.user();
    const bytes = fixtures.wav();
    const intent = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/uploads',
        headers: u.headers,
        payload: { intent: 'private_upload', size_bytes: bytes.length, sha256: sha256Hex(bytes) },
      })
    ).json();
    const early = await h.api.inject({
      method: 'POST',
      url: `/v1/uploads/${intent.upload.upload_id}/finalize`,
      headers: { ...u.headers, 'idempotency-key': 'early-finalize-1' },
    });
    expect(early.statusCode).toBe(422);
    expect(early.json().error.code).toBe('UPLOAD_MISSING');

    await fetch(intent.upload_url, { method: 'PUT', headers: intent.upload_headers, body: bytes });
    const fin = () =>
      h.api.inject({
        method: 'POST',
        url: `/v1/uploads/${intent.upload.upload_id}/finalize`,
        headers: { ...u.headers, 'idempotency-key': 'finalize-key-1' },
      });
    const [a, b] = [await fin(), await fin()];
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(b.json()).toEqual(a.json());
    const other = await h.api.inject({
      method: 'POST',
      url: `/v1/uploads/${intent.upload.upload_id}/finalize`,
      headers: { ...u.headers, 'idempotency-key': 'finalize-key-2' },
    });
    expect(other.statusCode).toBe(409);
    const sources = await h.ctx.db
      .selectFrom('audio_source')
      .select('id')
      .where('workspace_id', '=', u.workspaceId)
      .execute();
    expect(sources).toHaveLength(1);
    const missingKey = await h.api.inject({
      method: 'POST',
      url: `/v1/uploads/${intent.upload.upload_id}/finalize`,
      headers: u.headers,
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it('enforces the total quota atomically under concurrent intents', async () => {
    const small = await createHarness({
      QUOTA_FREE_MAX_TOTAL_BYTES: '1000',
      QUOTA_FREE_MAX_CONCURRENT_UPLOADS: '10',
    });
    try {
      const u = await small.user();
      const req = () =>
        small.api.inject({
          method: 'POST',
          url: '/v1/uploads',
          headers: u.headers,
          payload: {
            intent: 'private_upload',
            size_bytes: 400,
            sha256: sha256Hex(Buffer.alloc(400)),
          },
        });
      const results = await Promise.all([req(), req(), req(), req()]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 201, 413, 413]);
      expect(results.find((r) => r.statusCode === 413)!.json().error.code).toBe('QUOTA_EXCEEDED');
      const tooBig = await small.api.inject({
        method: 'POST',
        url: '/v1/uploads',
        headers: u.headers,
        payload: {
          intent: 'private_upload',
          size_bytes: 600 * 1024 * 1024,
          sha256: sha256Hex(Buffer.alloc(1)),
        },
      });
      expect(tooBig.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await small.close();
    }
  });

  it('limits concurrent uploads', async () => {
    const u = await h.user();
    const req = () =>
      h.api.inject({
        method: 'POST',
        url: '/v1/uploads',
        headers: u.headers,
        payload: { intent: 'private_upload', size_bytes: 10, sha256: sha256Hex(Buffer.alloc(10)) },
      });
    for (let i = 0; i < 3; i++) expect((await req()).statusCode).toBe(201);
    expect((await req()).statusCode).toBe(429);
  });

  it('cancels and expires unfinished uploads, releasing quota', async () => {
    const u = await h.user();
    const make = async () =>
      (
        await h.api.inject({
          method: 'POST',
          url: '/v1/uploads',
          headers: u.headers,
          payload: {
            intent: 'private_upload',
            size_bytes: 10,
            sha256: sha256Hex(Buffer.alloc(10)),
          },
        })
      ).json().upload.upload_id as string;
    const a = await make();
    const cancelled = await h.api.inject({
      method: 'DELETE',
      url: `/v1/uploads/${a}`,
      headers: u.headers,
    });
    expect(cancelled.json().state).toBe('cancelled');

    const b = await make();
    await h.ctx.db
      .updateTable('upload_session')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', b)
      .execute();
    const fin = await h.api.inject({
      method: 'POST',
      url: `/v1/uploads/${b}/finalize`,
      headers: { ...u.headers, 'idempotency-key': 'expired-final-1' },
    });
    expect(fin.statusCode).toBe(409);
    expect((await h.api.inject({ url: `/v1/uploads/${b}`, headers: u.headers })).json().state).toBe(
      'expired',
    );
    const me = (await h.api.inject({ url: '/v1/me', headers: u.headers })).json();
    expect(me.quota.reserved_bytes).toBe(0);
  });
});

describe('private audio: job retry and idempotency (T15)', () => {
  it('retries a transient storage failure and processes once', async () => {
    const u = await h.user();
    const original = h.ctx.blobs.download.bind(h.ctx.blobs);
    const { audioSourceId, uploadId } = await uploadBytes(h, u, fixtures.wav());
    // Fail exactly once, and only for this upload's object (other jobs share the queue).
    let failures = 1;
    h.ctx.blobs.download = (bucket, key, path) => {
      if (key.startsWith(`${uploadId}/`) && failures-- > 0) {
        return Promise.reject(new Error('transient storage error'));
      }
      return original(bucket, key, path);
    };
    try {
      await h.worker.drain();
      const job = await h.ctx.db
        .selectFrom('job')
        .select(['id', 'status', 'attempts'])
        .where('kind', '=', 'audio.process')
        .where('payload', '@>', JSON.stringify({ audio_source_id: audioSourceId }) as never)
        .executeTakeFirstOrThrow();
      expect(job.status).toBe('queued');
      await h.ctx.db
        .updateTable('job')
        .set({ run_after: new Date() })
        .where('id', '=', job.id)
        .execute();
      await h.worker.drain();
      const s = (
        await h.api.inject({ url: `/v1/audio-sources/${audioSourceId}`, headers: u.headers })
      ).json();
      expect(s.status).toBe('ready');
    } finally {
      h.ctx.blobs.download = original;
    }
  });

  it('re-running processing for a ready source changes nothing', async () => {
    const u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav());
    const before = await h.ctx.db
      .selectFrom('audio_asset')
      .selectAll()
      .where('audio_source_id', '=', id)
      .execute();
    const upload = await h.ctx.db
      .selectFrom('upload_session')
      .select('id')
      .where('audio_source_id', '=', id)
      .executeTakeFirstOrThrow();
    await h.ctx.db
      .insertInto('job')
      .values({
        id: 'job_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        kind: 'audio.process',
        payload: JSON.stringify({ audio_source_id: id, upload_session_id: upload.id }),
        dedupe_key: `manual-reprocess:${id}`,
        locked_by: null,
        locked_until: null,
        last_error: null,
        correlation_id: null,
      })
      .execute();
    await h.worker.drain();
    const after = await h.ctx.db
      .selectFrom('audio_asset')
      .selectAll()
      .where('audio_source_id', '=', id)
      .execute();
    expect(after).toEqual(before);
  });
});

describe('private audio: deletion (LIB-008, T16)', () => {
  it('blocks access immediately and removes all objects asynchronously', async () => {
    const u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav());
    const session = (await play(u, id)).json();
    const prefix = (
      await h.ctx.db
        .selectFrom('audio_source')
        .select('storage_prefix')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).storage_prefix;
    expect(
      (await h.ctx.blobs.listPrefix(BUCKETS.privateMedia, `${prefix}/`)).length,
    ).toBeGreaterThan(0);

    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${id}`,
      headers: u.headers,
    });
    expect(del.statusCode).toBe(202);
    expect(del.json().status).toBe('deleting');
    // Immediate block, before any job runs:
    expect((await h.media.inject({ url: mediaPath(session.manifest_url) })).statusCode).toBe(403);
    expect((await play(u, id)).statusCode).toBe(404);
    const refresh = await h.api.inject({
      method: 'POST',
      url: `/v1/playback-sessions/${session.session_id}/refresh`,
      headers: u.headers,
    });
    expect(refresh.statusCode).toBe(404);
    const list = (await h.api.inject({ url: '/v1/audio-sources', headers: u.headers })).json();
    expect(list.items).toEqual([]);

    await h.worker.drain();
    expect(await h.ctx.blobs.listPrefix(BUCKETS.privateMedia, `${prefix}/`)).toEqual([]);
    expect(await h.ctx.blobs.listPrefix(BUCKETS.privateOriginals, `${prefix}/`)).toEqual([]);
    const row = await h.ctx.db
      .selectFrom('audio_source')
      .select(['status', 'title'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'deleted', title: null });
    expect(
      (await h.api.inject({ url: `/v1/audio-sources/${id}`, headers: u.headers })).statusCode,
    ).toBe(404);
    const sessions = await h.ctx.db
      .selectFrom('playback_session')
      .select('status')
      .where('audio_source_id', '=', id)
      .execute();
    expect(sessions.every((s) => s.status === 'revoked')).toBe(true);
    const me = (await h.api.inject({ url: '/v1/me', headers: u.headers })).json();
    expect(me.quota.used_bytes).toBe(0);
  });

  it('deleting before processing releases the quota reservation and upload slot (review #1)', async () => {
    const u = await h.user();
    for (let i = 0; i < 4; i++) {
      const { audioSourceId, uploadId } = await uploadBytes(h, u, fixtures.wav());
      await h.api.inject({
        method: 'DELETE',
        url: `/v1/audio-sources/${audioSourceId}`,
        headers: u.headers,
      });
      await h.worker.drain();
      const up = (
        await h.api.inject({ url: `/v1/uploads/${uploadId}`, headers: u.headers })
      ).json();
      expect(up.state).toBe('cancelled');
    }
    const me = (await h.api.inject({ url: '/v1/me', headers: u.headers })).json();
    expect(me.quota).toMatchObject({ reserved_bytes: 0, used_bytes: 0 });
    // More deletes than the concurrent-upload cap (3) never lock the user out.
    await uploadBytes(h, u, fixtures.wav());
  });

  it('deleting during processing leaves no derivatives behind', async () => {
    const u = await h.user();
    const { audioSourceId } = await uploadBytes(h, u, fixtures.wav());
    await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${audioSourceId}`,
      headers: u.headers,
    });
    await h.worker.drain();
    const row = await h.ctx.db
      .selectFrom('audio_source')
      .select(['status', 'storage_prefix'])
      .where('id', '=', audioSourceId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('deleted');
    expect(await h.ctx.blobs.listPrefix(BUCKETS.privateMedia, `${row.storage_prefix}/`)).toEqual(
      [],
    );
    expect(
      await h.ctx.blobs.listPrefix(BUCKETS.privateOriginals, `${row.storage_prefix}/`),
    ).toEqual([]);
  });

  it('is idempotent', async () => {
    const u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav());
    const a = await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${id}`,
      headers: u.headers,
    });
    const b = await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${id}`,
      headers: u.headers,
    });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await h.worker.drain();
    const c = await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${id}`,
      headers: u.headers,
    });
    expect(c.statusCode).toBe(404);
  });
});

describe('private audio: expired and forged media access (T07, T08)', () => {
  let session: { manifest_url: string; session_id: string };
  let prefix: string;
  let u: TestUser;
  beforeAll(async () => {
    u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav());
    session = (await play(u, id)).json();
    prefix = (
      await h.ctx.db
        .selectFrom('audio_source')
        .select('storage_prefix')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).storage_prefix;
  });

  it('rejects expired, tampered and foreign-secret tokens', async () => {
    const codec = new MediaTokenCodec(h.ctx.config.secrets.mediaToken);
    const expired = codec.sign({
      sessionId: session.session_id,
      namespace: 'private',
      prefix,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expect((await h.media.inject({ url: `/media/v1/${expired}/index.m3u8` })).statusCode).toBe(403);
    const foreign = new MediaTokenCodec('another-secret-0123456789abcdef0123456789').sign({
      sessionId: session.session_id,
      namespace: 'private',
      prefix,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect((await h.media.inject({ url: `/media/v1/${foreign}/index.m3u8` })).statusCode).toBe(403);
    const token = mediaPath(session.manifest_url).split('/')[3]!;
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect((await h.media.inject({ url: `/media/v1/${tampered}/index.m3u8` })).statusCode).toBe(
      403,
    );
    // A token for another prefix (another user's source) is useless without a matching session.
    const otherPrefix = codec.sign({
      sessionId: session.session_id,
      namespace: 'private',
      prefix: 'asr_x/other',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect((await h.media.inject({ url: `/media/v1/${otherPrefix}/index.m3u8` })).statusCode).toBe(
      403,
    );
  });

  it('rejects path traversal and unknown files', async () => {
    const token = mediaPath(session.manifest_url).split('/')[3]!;
    for (const f of ['..%2F..%2Foriginal', 'original', 'waveform.json', 'seg_1.m4s', '.env']) {
      const r = await h.media.inject({ url: `/media/v1/${token}/${f}` });
      expect([403, 404]).toContain(r.statusCode);
    }
  });

  it('rejects requests after the session expires and allows refresh while valid', async () => {
    const refreshed = await h.api.inject({
      method: 'POST',
      url: `/v1/playback-sessions/${session.session_id}/refresh`,
      headers: u.headers,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(new Date(refreshed.json().expires_at).getTime()).toBeGreaterThan(Date.now());
    await h.ctx.db
      .updateTable('playback_session')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', session.session_id)
      .execute();
    expect(
      (await h.media.inject({ url: mediaPath(refreshed.json().manifest_url) })).statusCode,
    ).toBe(403);
    const late = await h.api.inject({
      method: 'POST',
      url: `/v1/playback-sessions/${session.session_id}/refresh`,
      headers: u.headers,
    });
    expect(late.statusCode).toBe(409);
  });

  it("does not let another user refresh someone else's session", async () => {
    const other = await h.user();
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/playback-sessions/${session.session_id}/refresh`,
      headers: other.headers,
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('account deletion', () => {
  it('blocks access immediately and deletes owned audio', async () => {
    const u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav());
    const del = await h.api.inject({ method: 'DELETE', url: '/v1/me', headers: u.headers });
    expect(del.statusCode).toBe(202);
    expect(del.json().state).toBe('requested');
    const blocked = await h.api.inject({ url: '/v1/audio-sources', headers: u.headers });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('ACCOUNT_DELETION_PENDING');
    expect((await h.api.inject({ url: '/v1/me', headers: u.headers })).json().status).toBe(
      'deletion_requested',
    );

    await h.worker.drain();
    const src = await h.ctx.db
      .selectFrom('audio_source')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(src.status).toBe('deleted');
    const user = await h.ctx.db
      .selectFrom('app_user')
      .select(['status', 'oidc_subject'])
      .where('id', '=', u.userId)
      .executeTakeFirstOrThrow();
    expect(user.status).toBe('deleted');
    expect(user.oidc_subject).not.toBe(u.subject);
    // The same identity can sign up again as a new, empty account.
    const again = await h.user({ subject: u.subject });
    expect(again.userId).not.toBe(u.userId);
  });
});
