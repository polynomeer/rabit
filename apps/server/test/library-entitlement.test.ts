import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogAccess } from '../src/app/registry.js';
import { resolveRef, resolveRefs, type RefType } from '../src/modules/library/resolve.js';
import type { Principal } from '../src/platform/http/principal.js';
import { newId, type Id } from '../src/platform/ids.js';
import { enqueue } from '../src/platform/jobs/queue.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { countQueries } from './helpers/query-count.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import {
  createHarness,
  mediaPath,
  uploadReady,
  type Harness,
  type TestUser,
} from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
const id = (k: string) => cat.ids[k]!;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
});
afterAll(() => h.close());

async function listener(opts: { country?: string; subscribe?: boolean } = {}) {
  const u = await h.user();
  if (opts.country !== undefined) await ops.setCountry(u, opts.country);
  if (opts.subscribe) await ops.subscribe(u);
  return u;
}

function playRecording(u: TestUser, recordingId: string, extra: Record<string, unknown> = {}) {
  return h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: recordingId, device_id: 'device-test-1', ...extra },
  });
}

describe('catalog and playability (ADR-0016)', () => {
  it('ingests catalog audio into the catalog namespace', async () => {
    const assets = await h.ctx.db
      .selectFrom('audio_asset')
      .select('bucket')
      .where('audio_source_id', 'in', Object.values(cat.sources))
      .execute();
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.bucket.startsWith('rabit-catalog-'))).toBe(true);
    const rec = await h.ctx.db
      .selectFrom('recording')
      .select('duration_ms')
      .where('id', '=', id('r1'))
      .executeTakeFirstOrThrow();
    expect(rec.duration_ms).toBeGreaterThan(2900);
  });

  it('explains why a recording cannot be played, step by step', async () => {
    const reason = async (u: TestUser, rec: string) =>
      (await h.api.inject({ url: `/v1/recordings/${rec}`, headers: u.headers })).json().playability;
    const nobody = await listener();
    expect(await reason(nobody, id('r1'))).toEqual({
      playable: false,
      reason: 'rights_unavailable',
    });
    const elsewhere = await listener({ country: 'US', subscribe: true });
    expect(await reason(elsewhere, id('r1'))).toEqual({
      playable: false,
      reason: 'rights_unavailable',
    });
    const unsubscribed = await listener({ country: 'KR' });
    expect(await reason(unsubscribed, id('r1'))).toEqual({
      playable: false,
      reason: 'subscription_required',
    });
    const subscriber = await listener({ country: 'KR', subscribe: true });
    expect(await reason(subscriber, id('r1'))).toEqual({ playable: true, reason: null });
    expect(await reason(subscriber, id('r4'))).toEqual({ playable: false, reason: 'no_audio' });
  });

  it('returns releases with ordered tracks and per-track playability', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const rel = (
      await h.api.inject({ url: `/v1/releases/${id('album')}`, headers: u.headers })
    ).json();
    expect(rel.tracks.map((t: { recording_id: string }) => t.recording_id)).toEqual([
      id('r1'),
      id('r2'),
    ]);
    expect(rel.label.entity_id).toBe(id('label'));
    expect(rel.release_date).toBe('2025-05-01');
    expect(
      rel.tracks.every((t: { playability: { playable: boolean } }) => t.playability.playable),
    ).toBe(true);
    const ent = (
      await h.api.inject({ url: `/v1/entities/${id('producer')}`, headers: u.headers })
    ).json();
    expect(ent).toMatchObject({ entity_type: 'person' });
    expect((await h.api.inject({ url: '/v1/entities/xyz', headers: u.headers })).statusCode).toBe(
      404,
    );
  });

  it('plays a licensed recording for an entitled listener through the media gateway', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const res = await playRecording(u, id('r1'));
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('catalog');
    expect((await h.media.inject({ url: mediaPath(res.json().manifest_url) })).statusCode).toBe(
      200,
    );
  });

  it('denies playback with the right error codes', async () => {
    expect(
      (await playRecording(await listener({ country: 'KR' }), id('r1'))).json().error.code,
    ).toBe('SUBSCRIPTION_REQUIRED');
    expect(
      (await playRecording(await listener({ country: 'JP', subscribe: true }), id('r1'))).json()
        .error.code,
    ).toBe('RIGHTS_UNAVAILABLE');
    expect(
      (await playRecording(await listener({ country: 'KR', subscribe: true }), id('r4')))
        .statusCode,
    ).toBe(404);
  });
});

describe('entitlement forgery (T12) and operator controls (T13)', () => {
  it('rejects client-supplied entitlement, region or subscription claims', async () => {
    const u = await listener({ country: 'KR' });
    for (const forged of [
      { entitlement_id: 'enl_x' },
      { license_country: 'KR' },
      { subscription: 'active' },
    ]) {
      const r = await playRecording(u, id('r1'), forged);
      expect(r.statusCode).toBe(400);
    }
  });

  it('allows ops endpoints only for operators, with a reason, and audits them', async () => {
    const u = await listener();
    const attempts = [
      {
        method: 'PUT' as const,
        url: `/v1/ops/users/${u.userId}/subscription`,
        payload: { state: 'active', paid_through: '2099-01-01T00:00:00Z', reason: 'please' },
      },
      {
        method: 'PUT' as const,
        url: `/v1/ops/users/${u.userId}/license-country`,
        payload: { license_country: 'KR', reason: 'please' },
      },
      {
        method: 'POST' as const,
        url: '/v1/ops/entitlements',
        payload: {
          user_id: u.userId,
          scope: 'release',
          resource_id: id('album'),
          capabilities: ['play'],
          reason: 'please',
        },
      },
      { method: 'POST' as const, url: '/v1/ops/rights-grants', payload: {} },
    ];
    for (const a of attempts) {
      const r = await h.api.inject({
        ...a,
        headers: { ...u.headers, 'idempotency-key': 'k-12345678' },
      });
      expect(r.statusCode, a.url).toBe(403);
    }
    const noReason = await h.api.inject({
      method: 'PUT',
      url: `/v1/ops/users/${u.userId}/license-country`,
      headers: ops.op.headers,
      payload: { license_country: 'KR' },
    });
    expect(noReason.statusCode).toBe(400);
    await ops.setCountry(u, 'KR');
    const log = await h.ctx.db
      .selectFrom('audit_log')
      .select(['actor_id', 'reason'])
      .where('subject_id', '=', u.userId)
      .where('action', '=', 'user.license_country_set')
      .executeTakeFirstOrThrow();
    expect(log).toEqual({ actor_id: ops.op.userId, reason: 'test setup' });
  });

  it('requires MFA for operator access', async () => {
    const token = await h.issuer.issue({
      subject: `op-nomfa-${Date.now()}`,
      operator: true,
      mfa: false,
    });
    const r = await h.api.inject({
      method: 'PUT',
      url: `/v1/ops/users/${ops.op.userId}/license-country`,
      headers: { authorization: `Bearer ${token}` },
      payload: { license_country: 'KR', reason: 'try without mfa' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('rights withdrawal (T14)', () => {
  it('blocks new sessions immediately and revokes active sessions', async () => {
    const own = await seedCatalog(h);
    const rec = own.ids['r1']!;
    const grant = await h.ctx.db
      .selectFrom('rights_grant')
      .select(['id', 'version'])
      .where('recording_id', '=', rec)
      .executeTakeFirstOrThrow();
    const u = await listener({ country: 'KR', subscribe: true });
    const session = (await playRecording(u, rec)).json();
    expect((await h.media.inject({ url: mediaPath(session.manifest_url) })).statusCode).toBe(200);

    const url = `/v1/ops/rights-grants/${grant.id}/status`;
    const payload = { status: 'suspended', reason: 'rights holder dispute' };
    expect(
      (await h.api.inject({ method: 'POST', url, headers: ops.op.headers, payload })).statusCode,
    ).toBe(428);
    expect(
      (
        await h.api.inject({
          method: 'POST',
          url,
          headers: { ...ops.op.headers, 'if-match': '"99"' },
          payload,
        })
      ).statusCode,
    ).toBe(412);
    const suspended = await h.api.inject({
      method: 'POST',
      url,
      headers: { ...ops.op.headers, 'if-match': `"${grant.version}"` },
      payload,
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.headers.etag).toBe(`"${grant.version + 1}"`);

    // New sessions are refused synchronously.
    expect((await playRecording(u, rec)).json().error.code).toBe('RIGHTS_UNAVAILABLE');
    // Active sessions are revoked by the event consumer.
    await h.worker.drain();
    expect((await h.media.inject({ url: mediaPath(session.manifest_url) })).statusCode).toBe(403);
    const refresh = await h.api.inject({
      method: 'POST',
      url: `/v1/playback-sessions/${session.session_id}/refresh`,
      headers: u.headers,
    });
    expect(refresh.statusCode).toBe(403);
    expect(refresh.json().error.code).toBe('RIGHTS_UNAVAILABLE');

    const reactivated = await h.api.inject({
      method: 'POST',
      url,
      headers: { ...ops.op.headers, 'if-match': suspended.headers.etag as string },
      payload: { status: 'active', reason: 'dispute resolved' },
    });
    expect(reactivated.statusCode).toBe(200);
    expect((await playRecording(u, rec)).statusCode).toBe(201);

    const revoked = await h.api.inject({
      method: 'POST',
      url,
      headers: { ...ops.op.headers, 'if-match': reactivated.headers.etag as string },
      payload: { status: 'revoked', reason: 'contract ended' },
    });
    expect(revoked.statusCode).toBe(200);
    const back = await h.api.inject({
      method: 'POST',
      url,
      headers: { ...ops.op.headers, 'if-match': revoked.headers.etag as string },
      payload: { status: 'active', reason: 'try again' },
    });
    expect(back.statusCode).toBe(409);
  });

  it('expires grants past their end date', async () => {
    const own = await seedCatalog(h);
    const rec = own.ids['r1']!;
    const u = await listener({ country: 'KR', subscribe: true });
    expect((await playRecording(u, rec)).statusCode).toBe(201);
    await h.ctx.db
      .updateTable('rights_grant')
      .set({ valid_to: new Date(Date.now() - 1000) })
      .where('recording_id', '=', rec)
      .execute();
    expect((await playRecording(u, rec)).json().error.code).toBe('RIGHTS_UNAVAILABLE');
    await enqueue(h.ctx.db, {
      kind: 'catalog.expire_grants',
      payload: {},
      dedupeKey: `test-expire-${rec}`,
    });
    await h.worker.drain();
    const g = await h.ctx.db
      .selectFrom('rights_grant')
      .select(['status', 'version'])
      .where('recording_id', '=', rec)
      .executeTakeFirstOrThrow();
    expect(g).toEqual({ status: 'expired', version: 2 });
  });
});

describe('license territory changes (review #12)', () => {
  it('revokes active sessions when the operator changes the license country', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const session = (await playRecording(u, id('r1'))).json();
    await ops.setCountry(u, 'US');
    await h.worker.drain();
    const row = await h.ctx.db
      .selectFrom('playback_session')
      .select('status')
      .where('id', '=', session.session_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('revoked');
    expect((await playRecording(u, id('r1'))).json().error.code).toBe('RIGHTS_UNAVAILABLE');
  });

  it('keeps sessions started after the change, even if the revocation job runs later', async () => {
    const u = await listener({ country: 'US', subscribe: true });
    await h.worker.drain();
    await ops.setCountry(u, 'KR');
    // Authorized under the new territory before the asynchronous revocation runs.
    const fresh = await playRecording(u, id('r1'));
    expect(fresh.statusCode).toBe(201);
    await h.worker.drain();
    const row = await h.ctx.db
      .selectFrom('playback_session')
      .select('status')
      .where('id', '=', fresh.json().session_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
  });
});

describe('account deletion and playback data (review #7)', () => {
  it('revokes sessions and deletes listening events of a deleted account', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const session = (await playRecording(u, id('r1'))).json();
    await h.api.inject({
      method: 'POST',
      url: '/v1/listening-events/batch',
      headers: u.headers,
      payload: {
        events: [
          {
            event_id: crypto.randomUUID(),
            session_id: session.session_id,
            sequence: 0,
            type: 'started',
            position_ms: 0,
            played_ms: 0,
            client_time: new Date().toISOString(),
          },
        ],
      },
    });
    await h.api.inject({ method: 'DELETE', url: '/v1/me', headers: u.headers });
    await h.worker.drain();
    const events = await h.ctx.db
      .selectFrom('listening_event')
      .select('id')
      .where('user_id', '=', u.userId)
      .execute();
    expect(events).toEqual([]);
    const sessions = await h.ctx.db
      .selectFrom('playback_session')
      .select('status')
      .where('user_id', '=', u.userId)
      .execute();
    expect(sessions.every((s) => s.status === 'revoked')).toBe(true);
  });
});

describe('subscriptions and entitlements are independent (COM-009)', () => {
  it('keeps operator-granted access after the subscription is cancelled', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const grant = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/entitlements',
      headers: { ...ops.op.headers, 'idempotency-key': `grant-${u.userId}` },
      payload: {
        user_id: u.userId,
        scope: 'release',
        resource_id: id('single'),
        capabilities: ['play'],
        reason: 'promo',
      },
    });
    expect(grant.statusCode).toBe(201);
    await ops.subscribe(u, 'cancelled');
    expect(
      (await h.api.inject({ url: '/v1/me', headers: u.headers })).json().subscription_state,
    ).toBe('cancelled');
    expect((await playRecording(u, id('r1'))).json().error.code).toBe('SUBSCRIPTION_REQUIRED');
    expect((await playRecording(u, id('r3'))).statusCode).toBe(201);

    const lib = await h.api.inject({
      method: 'POST',
      url: '/v1/library',
      headers: u.headers,
      payload: { ref_type: 'recording', ref_id: id('r3') },
    });
    expect(lib.json()).toMatchObject({ ownership: 'granted', playability: { playable: true } });

    const list = (await h.api.inject({ url: '/v1/entitlements', headers: u.headers })).json();
    const origins = list.items
      .map((e: { origin: string; status: string }) => `${e.origin}:${e.status}`)
      .sort();
    expect(origins).toEqual(['grant:active', 'subscription:expired']);

    const revoke = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/entitlements/${grant.json().entitlement_id}/status`,
      headers: { ...ops.op.headers, 'if-match': grant.headers.etag as string },
      payload: { status: 'revoked', reason: 'promo ended' },
    });
    expect(revoke.statusCode).toBe(200);
    expect((await playRecording(u, id('r3'))).json().error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('tracks the entitlement actually used after a refresh switches to another one (review #4)', async () => {
    const own = await seedCatalog(h);
    const rec = own.ids['r1']!;
    const u2 = await listener({ country: 'KR', subscribe: true });
    const session = (await playRecording(u2, rec)).json();
    const grant = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/entitlements',
      headers: { ...ops.op.headers, 'idempotency-key': `switch-${u2.userId}` },
      payload: {
        user_id: u2.userId,
        scope: 'recording',
        resource_id: rec,
        capabilities: ['play'],
        reason: 'promo',
      },
    });
    // Purchase/grant entitlements take precedence: the refresh now runs under the grant.
    expect(
      (
        await h.api.inject({
          method: 'POST',
          url: `/v1/playback-sessions/${session.session_id}/refresh`,
          headers: u2.headers,
        })
      ).statusCode,
    ).toBe(200);
    // Only the grant the session now depends on changes; nothing else may mask the bug.
    const revoke = await h.api.inject({
      method: 'POST',
      url: `/v1/ops/entitlements/${grant.json().entitlement_id}/status`,
      headers: { ...ops.op.headers, 'if-match': grant.headers.etag as string },
      payload: { status: 'revoked', reason: 'promo ended' },
    });
    expect(revoke.statusCode).toBe(200);
    await h.worker.drain();
    const row = await h.ctx.db
      .selectFrom('playback_session')
      .select('status')
      .where('id', '=', session.session_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('revoked');
  });

  it('does not grant access while past due (fail closed)', async () => {
    const u = await listener({ country: 'KR' });
    await ops.subscribe(u, 'past_due');
    expect((await playRecording(u, id('r1'))).json().error.code).toBe('SUBSCRIPTION_REQUIRED');
  });
});

describe('library (LIB-001..004)', () => {
  let u: TestUser;
  let other: TestUser;
  let privateId: string;
  let logId: string;
  beforeAll(async () => {
    u = await listener({ country: 'KR', subscribe: true });
    other = await listener();
    privateId = await uploadReady(h, u, fixtures.wav());
    logId = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
  });

  it('puts the user own uploads and Audio Logs in the library automatically', async () => {
    const items = (
      await h.api.inject({ url: '/v1/library?ref_type=audio_source', headers: u.headers })
    ).json().items;
    const byRef = Object.fromEntries(
      items.map((i: { ref_id: string; origin: string; ownership: string }) => [
        i.ref_id,
        `${i.origin}/${i.ownership}`,
      ]),
    );
    expect(byRef[privateId]).toBe('uploaded/private');
    expect(byRef[logId]).toBe('logged/audio_log');
  });

  it('saves catalog items with ownership labels and rejects duplicates', async () => {
    const add = (ref_type: string, ref_id: string) =>
      h.api.inject({
        method: 'POST',
        url: '/v1/library',
        headers: u.headers,
        payload: { ref_type, ref_id },
      });
    const rec = await add('recording', id('r1'));
    expect(rec.statusCode).toBe(201);
    expect(rec.json()).toMatchObject({
      origin: 'saved',
      ownership: 'streaming',
      playability: { playable: true },
    });
    expect((await add('release', id('album'))).statusCode).toBe(201);
    expect((await add('recording', id('r1'))).statusCode).toBe(409);
    expect((await add('recording', 'rec_01ARZ3NDEKTSV4RRFFQ69G5FAV')).statusCode).toBe(404);
    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/library/${rec.json().library_item_id}`,
      headers: u.headers,
    });
    expect(del.statusCode).toBe(204);
    // Removing from the library never touches entitlements.
    expect((await playRecording(u, id('r1'))).statusCode).toBe(201);
  });

  it("never lets another user save or see someone else's private audio", async () => {
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/library',
      headers: other.headers,
      payload: { ref_type: 'audio_source', ref_id: privateId },
    });
    expect(r.statusCode).toBe(404);
    const items = (
      await h.api.inject({ url: '/v1/library?limit=100', headers: other.headers })
    ).json().items;
    expect(items.map((i: { ref_id: string }) => i.ref_id)).not.toContain(privateId);
  });
});

describe('mixed playlists (PB Phase 13)', () => {
  let u: TestUser;
  let other: TestUser;
  let privateId: string;
  let logId: string;
  let pl: { playlist_id: string; version: number };
  let tag: string;

  beforeAll(async () => {
    u = await listener({ country: 'KR', subscribe: true });
    other = await listener({ country: 'KR', subscribe: true });
    privateId = await uploadReady(h, u, fixtures.wav(), { filename: 'Demo.wav' });
    logId = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    const res = await h.api.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: u.headers,
      payload: { title: 'Mixed' },
    });
    expect(res.statusCode).toBe(201);
    pl = res.json();
    tag = res.headers.etag as string;
    expect(tag).toBe('"1"');
  });

  async function add(ref_type: string, ref_id: string, position?: number) {
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${pl.playlist_id}/items`,
      headers: { ...u.headers, 'if-match': tag },
      payload: { ref_type, ref_id, ...(position === undefined ? {} : { position }) },
    });
    if (r.statusCode === 201) tag = r.headers.etag as string;
    return r;
  }

  it('holds catalog, private and Audio Log items together, referencing ids only', async () => {
    expect((await add('recording', id('r1'))).statusCode).toBe(201);
    expect((await add('audio_source', privateId)).statusCode).toBe(201);
    const r = await add('audio_source', logId, 0);
    expect(r.statusCode).toBe(201);
    const items = r.json().items;
    expect(items.map((i: { ref_id: string }) => i.ref_id)).toEqual([logId, id('r1'), privateId]);
    expect(items.map((i: { ownership: string }) => i.ownership)).toEqual([
      'audio_log',
      'streaming',
      'private',
    ]);
    expect(items.every((i: { playability: { playable: boolean } }) => i.playability.playable)).toBe(
      true,
    );
    const cols = await h.ctx.db
      .selectFrom('playlist_item')
      .selectAll()
      .where('playlist_id', '=', pl.playlist_id)
      .execute();
    expect(JSON.stringify(cols)).not.toMatch(/https?:|rabit-|\/hls\//);
  });

  it('requires If-Match and rejects stale versions (concurrent edits)', async () => {
    const noMatch = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${pl.playlist_id}/items`,
      headers: u.headers,
      payload: { ref_type: 'recording', ref_id: id('r2') },
    });
    expect(noMatch.statusCode).toBe(428);
    const both = await Promise.all(
      [id('r2'), id('r3')].map((ref) =>
        h.api.inject({
          method: 'POST',
          url: `/v1/playlists/${pl.playlist_id}/items`,
          headers: { ...u.headers, 'if-match': tag },
          payload: { ref_type: 'recording', ref_id: ref },
        }),
      ),
    );
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 412]);
    tag = both.find((r) => r.statusCode === 201)!.headers.etag as string;
    const view = (
      await h.api.inject({ url: `/v1/playlists/${pl.playlist_id}`, headers: u.headers })
    ).json();
    expect(view.items).toHaveLength(4);
    expect(view.items.map((i: { position: number }) => i.position)).toEqual([0, 1, 2, 3]);
  });

  it('moves and removes items keeping positions dense', async () => {
    let view = (
      await h.api.inject({ url: `/v1/playlists/${pl.playlist_id}`, headers: u.headers })
    ).json();
    const first = view.items[0].item_id;
    const moved = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${pl.playlist_id}/items/${first}/move`,
      headers: { ...u.headers, 'if-match': tag },
      payload: { position: 99 },
    });
    expect(moved.statusCode).toBe(200);
    tag = moved.headers.etag as string;
    view = moved.json();
    expect(view.items.at(-1).item_id).toBe(first);
    const removed = await h.api.inject({
      method: 'DELETE',
      url: `/v1/playlists/${pl.playlist_id}/items/${
        view.items.find(
          (i: { ref_type: string; ref_id: string }) =>
            i.ref_type === 'recording' && i.ref_id !== id('r1'),
        ).item_id
      }`,
      headers: { ...u.headers, 'if-match': tag },
    });
    tag = removed.headers.etag as string;
    expect(removed.json().items.map((i: { position: number }) => i.position)).toEqual([0, 1, 2]);
  });

  it("never exposes or accepts another user's private items", async () => {
    expect(
      (await h.api.inject({ url: `/v1/playlists/${pl.playlist_id}`, headers: other.headers }))
        .statusCode,
    ).toBe(404);
    const otherPl = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/playlists',
        headers: other.headers,
        payload: { title: 'x' },
      })
    ).json();
    const r = await h.api.inject({
      method: 'POST',
      url: `/v1/playlists/${otherPl.playlist_id}/items`,
      headers: { ...other.headers, 'if-match': '"1"' },
      payload: { ref_type: 'audio_source', ref_id: privateId },
    });
    expect(r.statusCode).toBe(404);
    const edit = await h.api.inject({
      method: 'PATCH',
      url: `/v1/playlists/${pl.playlist_id}`,
      headers: { ...other.headers, 'if-match': tag },
      payload: { title: 'hijack' },
    });
    expect(edit.statusCode).toBe(404);
  });

  it('re-evaluates availability on every read (deleted and unavailable items)', async () => {
    await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${privateId}`,
      headers: u.headers,
    });
    await ops.subscribe(u, 'expired');
    const view = (
      await h.api.inject({ url: `/v1/playlists/${pl.playlist_id}`, headers: u.headers })
    ).json();
    const byRef = Object.fromEntries(
      view.items.map((i: { ref_id: string; playability: { reason: string } }) => [
        i.ref_id,
        i.playability.reason,
      ]),
    );
    expect(byRef[privateId]).toBe('deleted');
    expect(byRef[id('r1')]).toBe('subscription_required');
    expect(byRef[logId]).toBeNull();
    await ops.subscribe(u, 'active');
  });

  it('deletes with If-Match', async () => {
    const del = await h.api.inject({
      method: 'DELETE',
      url: `/v1/playlists/${pl.playlist_id}`,
      headers: { ...u.headers, 'if-match': tag },
    });
    expect(del.statusCode).toBe(204);
    expect(
      (await h.api.inject({ url: `/v1/playlists/${pl.playlist_id}`, headers: u.headers }))
        .statusCode,
    ).toBe(404);
  });
});

describe('large playlists and batched availability (review #6)', () => {
  const principalOf = (u: TestUser): Principal => ({
    userId: u.userId as Id<'user'>,
    personalWorkspaceId: u.workspaceId as Id<'workspace'>,
    status: 'active',
    isOperator: false,
  });

  async function seedPlaylist(
    u: TestUser,
    refs: { ref_type: 'recording' | 'audio_source'; ref_id: string }[],
  ) {
    const pl = (
      await h.api.inject({
        method: 'POST',
        url: '/v1/playlists',
        headers: u.headers,
        payload: { title: `big ${refs.length}` },
      })
    ).json<{ playlist_id: string }>();
    if (refs.length === 0) return pl.playlist_id;
    await h.ctx.db
      .insertInto('playlist_item')
      .values(
        refs.map((r, rank) => ({
          id: newId('playlistItem'),
          playlist_id: pl.playlist_id,
          rank,
          ...r,
        })),
      )
      .execute();
    return pl.playlist_id;
  }

  it('pages playlist items with version-bound cursors and per-item availability', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const mine = await uploadReady(h, u, fixtures.wav());
    const cycle = [
      { ref_type: 'recording' as const, ref_id: id('r1') },
      { ref_type: 'recording' as const, ref_id: id('r4') },
      { ref_type: 'audio_source' as const, ref_id: mine },
    ];
    const refs = Array.from({ length: 250 }, (_, i) => cycle[i % 3]!);
    const plId = await seedPlaylist(u, refs);

    const first = await h.api.inject({ url: `/v1/playlists/${plId}`, headers: u.headers });
    expect(first.statusCode).toBe(200);
    const view = first.json();
    expect(view.item_count).toBe(250);
    expect(view.items).toHaveLength(100);
    expect(first.headers.etag).toBe(`"${view.version}"`);

    const seen = [...view.items];
    let cursor: string | null = view.items_next_cursor;
    while (cursor) {
      const r = await h.api.inject({
        url: `/v1/playlists/${plId}/items?limit=100&cursor=${encodeURIComponent(cursor)}`,
        headers: u.headers,
      });
      expect(r.statusCode).toBe(200);
      seen.push(...r.json().items);
      cursor = r.json().next_cursor;
    }
    expect(seen.map((i: { position: number }) => i.position)).toEqual(refs.map((_, i) => i));
    expect(seen.map((i: { ref_id: string }) => i.ref_id)).toEqual(refs.map((r) => r.ref_id));
    const reasons = seen
      .slice(-3)
      .map((i: { playability: { reason: string | null } }) => i.playability.reason);
    // positions 247, 248, 249 → r4 (no audio), private source, r1
    expect(reasons).toEqual(['no_audio', null, null]);

    // An edit invalidates older cursors instead of silently skipping or repeating items.
    const stale = view.items_next_cursor as string;
    const edit = await h.api.inject({
      method: 'PATCH',
      url: `/v1/playlists/${plId}`,
      headers: { ...u.headers, 'if-match': `"${view.version}"` },
      payload: { title: 'renamed' },
    });
    expect(edit.statusCode).toBe(200);
    const after = await h.api.inject({
      url: `/v1/playlists/${plId}/items?cursor=${encodeURIComponent(stale)}`,
      headers: u.headers,
    });
    expect(after.statusCode).toBe(409);
    expect(after.json().error.code).toBe('INVALID_STATE');

    // Cursors are bound to the caller and the playlist.
    const other = await listener();
    const foreign = await h.api.inject({
      url: `/v1/playlists/${plId}/items?cursor=${encodeURIComponent(stale)}`,
      headers: other.headers,
    });
    expect([400, 404]).toContain(foreign.statusCode);
    const otherPl = await seedPlaylist(u, []);
    const crossed = await h.api.inject({
      url: `/v1/playlists/${otherPl}/items?cursor=${encodeURIComponent(stale)}`,
      headers: u.headers,
    });
    expect(crossed.statusCode).toBe(400);
  });

  it('reads a playlist with a constant number of queries, independent of its size', async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const refs = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ref_type: 'recording' as const,
        ref_id: id(['r1', 'r2', 'r3', 'r4'][i % 4]!),
      }));
    const small = await seedPlaylist(u, refs(8));
    const large = await seedPlaylist(u, refs(1000));
    const read = (plId: string) =>
      countQueries(h, async () => {
        const r = await h.api.inject({ url: `/v1/playlists/${plId}`, headers: u.headers });
        expect(r.statusCode).toBe(200);
      });
    const smallQueries = await read(small);
    const largeQueries = await read(large);
    expect(largeQueries).toBe(smallQueries);
    expect(largeQueries).toBeLessThanOrEqual(15);
  });

  it('resolves a batch exactly like resolving each reference alone', async () => {
    const u = await listener({ country: 'KR' }); // territory but no subscription
    const stranger = await listener();
    const mine = await uploadReady(h, u, fixtures.wav());
    const log = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    const gone = await uploadReady(h, u, fixtures.wav());
    const theirs = await uploadReady(h, stranger, fixtures.wav());
    await h.api.inject({ method: 'DELETE', url: `/v1/audio-sources/${gone}`, headers: u.headers });
    // A release-scoped grant covers both album tracks (r1, r2) and nothing else.
    const grant = await h.api.inject({
      method: 'POST',
      url: '/v1/ops/entitlements',
      headers: { ...ops.op.headers, 'idempotency-key': `batch-${u.userId}` },
      payload: {
        user_id: u.userId,
        scope: 'release',
        resource_id: id('album'),
        capabilities: ['play'],
        reason: 'batch test',
      },
    });
    expect(grant.statusCode).toBe(201);
    const refs: { type: RefType; id: string }[] = [
      { type: 'audio_source', id: mine },
      { type: 'audio_source', id: log },
      { type: 'audio_source', id: gone },
      { type: 'audio_source', id: theirs },
      { type: 'audio_source', id: cat.sources['r1']! },
      { type: 'recording', id: id('r1') },
      { type: 'recording', id: id('r2') },
      { type: 'recording', id: id('r4') },
      { type: 'release', id: id('album') },
      { type: 'release', id: id('single') },
      { type: 'recording', id: newId('recording') },
      { type: 'recording', id: id('r1') },
    ];
    const p = principalOf(u);
    const batch = await resolveRefs(h.ctx.db, catalogAccess, p, refs);
    const single = await Promise.all(refs.map((r) => resolveRef(h.ctx.db, catalogAccess, p, r)));
    expect(batch).toEqual(single);
    expect(batch.map((r) => [r.ownership, r.playability.reason])).toEqual([
      ['private', null],
      ['audio_log', null],
      [null, 'deleted'],
      [null, 'not_found'],
      [null, 'not_found'], // catalog audio is never addressable as a private source
      ['granted', null],
      ['granted', null],
      ['streaming', 'no_audio'],
      ['granted', null],
      ['streaming', 'subscription_required'],
      [null, 'not_found'],
      ['granted', null],
    ]);
  });
});

describe('export (LIB-006/007)', () => {
  it('invalidates ready exports when audio they contain is deleted (review #8)', async () => {
    const u = await listener();
    const src = await uploadReady(h, u, fixtures.wav());
    const req = await h.api.inject({
      method: 'POST',
      url: '/v1/exports',
      headers: { ...u.headers, 'idempotency-key': 'export-key-0002' },
      payload: {},
    });
    await h.worker.drain();
    const ready = await h.ctx.db
      .selectFrom('export_request')
      .select(['state', 'object_key'])
      .where('id', '=', req.json().export_id)
      .executeTakeFirstOrThrow();
    expect(ready.state).toBe('ready');
    await h.api.inject({ method: 'DELETE', url: `/v1/audio-sources/${src}`, headers: u.headers });
    await h.worker.drain();
    const after = (
      await h.api.inject({ url: `/v1/exports/${req.json().export_id}`, headers: u.headers })
    ).json();
    expect(after).toMatchObject({ state: 'expired', download_url: null });
    expect(await h.ctx.blobs.head('rabit-exports', ready.object_key!)).toBeNull();
  });

  it("packages only the user's own originals and metadata", async () => {
    const u = await listener({ country: 'KR', subscribe: true });
    const src = await uploadReady(h, u, fixtures.flac(), { filename: 'mine.flac' });
    await h.api.inject({
      method: 'POST',
      url: '/v1/library',
      headers: u.headers,
      payload: { ref_type: 'recording', ref_id: id('r1') },
    });
    const req = await h.api.inject({
      method: 'POST',
      url: '/v1/exports',
      headers: { ...u.headers, 'idempotency-key': 'export-key-0001' },
      payload: { include_originals: true },
    });
    expect(req.statusCode).toBe(202);
    expect(req.json()).toMatchObject({ state: 'requested', download_url: null });
    await h.worker.drain();
    const ready = (
      await h.api.inject({ url: `/v1/exports/${req.json().export_id}`, headers: u.headers })
    ).json();
    expect(ready.state).toBe('ready');
    const zip = Buffer.from(await (await fetch(ready.download_url)).arrayBuffer());
    const path = join(mkdtempSync(join(tmpdir(), 'rabit-exp-')), 'e.zip');
    writeFileSync(path, zip);
    const names = execFileSync('unzip', ['-Z1', path]).toString().trim().split('\n').sort();
    expect(names).toEqual(['metadata.json', `originals/${src}.flac`]);
    const meta = JSON.parse(execFileSync('unzip', ['-p', path, 'metadata.json']).toString());
    expect(meta.audio.map((a: { audio_source_id: string }) => a.audio_source_id)).toEqual([src]);
    expect(meta.library.map((l: { ref_id: string }) => l.ref_id)).toEqual(
      expect.arrayContaining([src, id('r1')]),
    );
    // Catalog masters are never exported.
    for (const c of Object.values(cat.sources)) expect(JSON.stringify(meta)).not.toContain(c);

    const other = await listener();
    expect(
      (await h.api.inject({ url: `/v1/exports/${req.json().export_id}`, headers: other.headers }))
        .statusCode,
    ).toBe(404);
  });
});
