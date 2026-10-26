import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/platform/ids.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

/**
 * Original-song lineage (DIG-003, TRU-005): stored samples/covers/remixes around one
 * recording, two steps each way, with provenance; the listener's own covers only for them.
 */
let h: Harness;
let u: TestUser;
let other: TestUser;
let id: (k: string) => string;

interface Lineage {
  root: { entity: { entity_id: string }; playability: { playable: boolean } };
  nodes: {
    entity: { entity_id: string };
    side: 'origin' | 'derived';
    depth: number;
    derivative_count: number | null;
  }[];
  edges: {
    type: string;
    derived_id: string;
    original_id: string;
    evidence: { basis: string; license_status: string | null; reason: { code: string } };
  }[];
  own_recordings: { audio_log_id: string; linked_recording_id: string; title: string }[];
  truncated: boolean;
}

const lineage = async (recordingId: string, query = '', who: TestUser = u) => {
  const r = await h.api.inject({
    url: `/v1/dig/entities/${recordingId}/lineage${query}`,
    headers: who.headers,
  });
  return r;
};
const ok = async (recordingId: string, query = '', who: TestUser = u) => {
  const r = await lineage(recordingId, query, who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<Lineage>();
};
const node = (l: Lineage, key: string) => l.nodes.find((n) => n.entity.entity_id === id(key));

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  other = await h.user();
  const cat = await seedCatalog(h);
  id = (k) => cat.ids[k]!;
  // The fixture has r3 samples r1 (verified). Add r4 covers r3 (declared) and an
  // inferred r2 remix of r1, so r1 has a two-step line and a hidden guess.
  const relation = (from: string, to: string, type: 'covers' | 'remix_of', inferred: boolean) =>
    h.ctx.db
      .insertInto('music_relation')
      .values({
        id: newId('relation'),
        from_entity_id: id(from),
        to_entity_id: id(to),
        relation_type: type,
        basis: inferred ? 'ml_inferred' : 'declared',
        confidence: inferred ? 0.7 : null,
        verification_state: 'self_declared',
        source: 'test',
        evidence_ref: null,
        license_status: 'unknown',
        valid_from: null,
        valid_to: null,
      })
      .execute();
  await relation('r4', 'r3', 'covers', false);
  await relation('r2', 'r1', 'remix_of', true);
});
afterAll(async () => {
  await h.close();
});

describe('original-song lineage', () => {
  it('walks two steps each way from a recording, with provenance on every edge', async () => {
    const l = await ok(id('r3'));
    expect(l.root.entity.entity_id).toBe(id('r3'));
    expect(node(l, 'r1')).toMatchObject({ side: 'origin', depth: 1, derivative_count: 1 });
    expect(node(l, 'r4')).toMatchObject({ side: 'derived', depth: 1, derivative_count: null });
    // influenced_by is not lineage, and the inferred remix is hidden by default.
    expect(node(l, 'r2')).toBeUndefined();
    const sample = l.edges.find((e) => e.type === 'samples');
    expect(sample).toMatchObject({
      derived_id: id('r3'),
      original_id: id('r1'),
      evidence: {
        basis: 'verified_fact',
        license_status: 'licensed',
        reason: { code: 'lineage.samples' },
      },
    });
    expect(l.truncated).toBe(false);
  });

  it('reaches the second step and stops at the requested depth', async () => {
    const two = await ok(id('r1'));
    expect(node(two, 'r3')).toMatchObject({ side: 'derived', depth: 1 });
    expect(node(two, 'r4')).toMatchObject({ side: 'derived', depth: 2 });
    const one = await ok(id('r1'), '?depth=1');
    expect(node(one, 'r4')).toBeUndefined();
  });

  it('shows inferred relations only when asked, and counts them in the hint then', async () => {
    const withGuess = await ok(id('r1'), '?include_inferred=true');
    expect(node(withGuess, 'r2')).toMatchObject({ side: 'derived', depth: 1 });
    const edge = withGuess.edges.find((e) => e.derived_id === id('r2'));
    expect(edge?.evidence.basis).toBe('ml_inferred');
    const fromR3 = await ok(id('r3'), '?include_inferred=true');
    expect(node(fromR3, 'r1')?.derivative_count).toBe(2);
  });

  it("adds the listener's own linked recordings for them alone", async () => {
    const sourceId = await uploadReady(h, u, fixtures.wav(), { intent: 'audio_log' });
    const log = await h.api.inject({
      method: 'POST',
      url: '/v1/audio-logs',
      headers: u.headers,
      payload: {
        audio_source_id: sourceId,
        title: 'My guitar cover',
        recorded_at: '2026-10-20T10:00:00Z',
        recorded_tz: 'Asia/Seoul',
        linked_recording_id: id('r1'),
      },
    });
    expect(log.statusCode, log.body).toBe(201);
    const mine = await ok(id('r3'));
    expect(mine.own_recordings).toMatchObject([
      { linked_recording_id: id('r1'), title: 'My guitar cover' },
    ]);
    const theirs = await lineage(id('r3'), '', other);
    expect(theirs.json<Lineage>().own_recordings).toEqual([]);
    expect(theirs.body).not.toContain('My guitar cover');
  });

  it('answers 404 for anything but a recording', async () => {
    expect((await lineage(id('album'))).statusCode).toBe(404);
    expect((await lineage('rec_01ARZ3NDEKTSV4RRFFQ69G5FAV')).statusCode).toBe(404);
    expect((await lineage(id('r1'), '?depth=3')).statusCode).toBe(400);
  });
});
