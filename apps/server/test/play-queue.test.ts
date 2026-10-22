import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures } from './helpers/audio-fixtures.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

/** The account's play queue and track-based autoplay (ADR-0026). */
let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
});
afterAll(() => h.close());

type Item = {
  item_id: string;
  origin: 'user' | 'autoplay';
  state: 'played' | 'current' | 'upcoming';
  recording_id: string | null;
  audio_source_id: string | null;
  reason: { code: string; name: string | null; basis: string } | null;
  playable: boolean;
};
type Queue = {
  mode: string;
  autoplay: boolean;
  current_item_id: string | null;
  items: Item[];
};

async function listener() {
  const u = await h.user();
  await ops.setCountry(u, 'KR');
  await ops.subscribe(u);
  return u;
}

const id = (k: string) => cat.ids[k]!;
const call = async (
  u: TestUser,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) => {
  const r = await h.api.inject({
    method,
    url,
    headers: u.headers,
    ...(payload ? { payload } : {}),
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<Queue>();
};
const add = (u: TestUser, refs: string[], placement: 'now' | 'next' | 'end') =>
  call(u, 'POST', '/v1/queue/items', {
    items: refs.map((r) => ({ recording_id: r })),
    placement,
  });
const chosen = (q: Queue) => q.items.filter((i) => i.origin === 'user').map((i) => i.recording_id);
const suggested = (q: Queue) => q.items.filter((i) => i.origin === 'autoplay');

describe('play queue', () => {
  it('plays an album now and suggests from the current track, with reasons', async () => {
    const u = await listener();
    const q = await add(u, [id('r1'), id('r2')], 'now');
    expect(chosen(q)).toEqual([id('r1'), id('r2')]);
    expect(q.items[0]).toMatchObject({ state: 'current', recording_id: id('r1') });
    // r3 samples r1 (verified): the closest suggestion, after the chosen tracks.
    const s = suggested(q);
    expect(s[0]).toMatchObject({
      recording_id: id('r3'),
      state: 'upcoming',
      reason: { code: 'sampled_by', basis: 'verified_fact' },
      playable: true,
    });
    expect(q.items.findIndex((i) => i.origin === 'autoplay')).toBeGreaterThan(1);
    // Nothing chosen is suggested again, and a track without audio never is.
    expect(s.map((i) => i.recording_id)).not.toContain(id('r2'));
    expect(s.map((i) => i.recording_id)).not.toContain(id('r4'));
    // The queue is on the account: another device reads the same.
    expect((await call(u, 'GET', '/v1/queue')).items).toEqual(q.items);
  });

  it('keeps played tracks as history and follows the new track', async () => {
    const u = await listener();
    const first = await add(u, [id('r1'), id('r2')], 'now');
    const next = first.items.find((i) => i.recording_id === id('r2'))!;
    const q = await call(u, 'POST', '/v1/queue/current', { item_id: next.item_id });
    expect(q.items[0]).toMatchObject({ recording_id: id('r1'), state: 'played' });
    expect(q.current_item_id).toBe(next.item_id);
    // From r2 the inferred influence is left out unless the listener includes it.
    expect(suggested(q).find((i) => i.recording_id === id('r3'))?.reason?.code).toBe('same_label');
    const inferred = await call(u, 'PATCH', '/v1/queue/settings', { include_inferred: true });
    expect(suggested(inferred).find((i) => i.recording_id === id('r3'))?.reason).toMatchObject({
      code: 'influenced_by',
      basis: 'ml_inferred',
    });
    // History recordings are not suggested again.
    expect(suggested(inferred).map((i) => i.recording_id)).not.toContain(id('r1'));
  });

  it('adds to the end of the chosen tracks, before suggestions, and keeps a suggestion', async () => {
    const u = await listener();
    await add(u, [id('r1')], 'now');
    const q = await add(u, [id('r2')], 'end');
    const at = q.items.findIndex((i) => i.recording_id === id('r2'));
    expect(q.items[at - 1]?.origin).toBe('user');
    expect(q.items.slice(at + 1).every((i) => i.origin === 'autoplay')).toBe(true);

    const s = suggested(q)[0]!;
    const kept = await call(u, 'POST', `/v1/queue/items/${s.item_id}/keep`);
    expect(kept.items.find((i) => i.item_id === s.item_id)?.origin).toBe('user');
    // A kept suggestion survives the next regeneration.
    const again = await call(u, 'POST', '/v1/queue/suggestions/refresh');
    expect(again.items.find((i) => i.item_id === s.item_id)?.origin).toBe('user');
  });

  it('in 자동추천 mode a new track replaces what was coming; history stays', async () => {
    const u = await listener();
    await add(u, [id('r1'), id('r2')], 'now');
    await call(u, 'PATCH', '/v1/queue/settings', { mode: 'radio' });
    const q = await add(u, [id('r3')], 'now');
    expect(q.mode).toBe('radio');
    expect(q.items[0]).toMatchObject({ recording_id: id('r1'), state: 'played' });
    expect(chosen(q)).toEqual([id('r1'), id('r3')]);
    expect(q.items.find((i) => i.state === 'current')?.recording_id).toBe(id('r3'));
  });

  it('with autoplay off, playback ends with the chosen tracks', async () => {
    const u = await listener();
    await call(u, 'PATCH', '/v1/queue/settings', { autoplay: false });
    const q = await add(u, [id('r1'), id('r2')], 'now');
    expect(suggested(q)).toHaveLength(0);
  });

  it('removes items and clears upcoming, suggestions or history', async () => {
    const u = await listener();
    const first = await add(u, [id('r1'), id('r2')], 'now');
    const r2 = first.items.find((i) => i.recording_id === id('r2'))!;
    const removed = await call(u, 'DELETE', `/v1/queue/items/${r2.item_id}`);
    expect(chosen(removed)).toEqual([id('r1')]);
    expect(
      suggested(await call(u, 'POST', '/v1/queue/clear', { scope: 'suggestions' })),
    ).toHaveLength(0);
    const cleared = await call(u, 'POST', '/v1/queue/clear', { scope: 'all' });
    expect(cleared.items).toEqual([]);
    expect(cleared.current_item_id).toBeNull();
  });

  it("queues the listener's own audio, never someone else's", async () => {
    const [owner, other] = [await listener(), await listener()];
    const sourceId = await uploadReady(h, owner, fixtures.wav());
    const q = await call(owner, 'POST', '/v1/queue/items', {
      items: [{ audio_source_id: sourceId }],
      placement: 'now',
    });
    expect(q.items[0]).toMatchObject({
      audio_source_id: sourceId,
      state: 'current',
      playable: true,
    });
    // Private audio is never a seed: no suggestions from it.
    expect(suggested(q)).toHaveLength(0);
    const r = await h.api.inject({
      method: 'POST',
      url: '/v1/queue/items',
      headers: other.headers,
      payload: { items: [{ audio_source_id: sourceId }], placement: 'end' },
    });
    expect(r.statusCode).toBe(404);
  });
});
