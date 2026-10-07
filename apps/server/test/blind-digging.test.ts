import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let ops: Awaited<ReturnType<typeof asOperator>>;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let listener: TestUser;
beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
  listener = await h.user();
  await ops.setCountry(listener, 'KR');
  await ops.subscribe(listener);
});
afterAll(() => h.close());

type Round = {
  blind_dig_id: string;
  items: {
    item_id: string;
    recording_id: string;
    decision: string | null;
    reveal: {
      recording: { entity_id: string; name: string };
      release: { release_id: string } | null;
      popularity_tier: string;
    } | null;
  }[];
};

const start = (u: TestUser, payload: Record<string, unknown> = {}) =>
  h.api.inject({ method: 'POST', url: '/v1/blind-digs', headers: u.headers, payload });

describe('Blind Digging (DIG-010)', () => {
  it('deals playable recordings from a start entity and reveals nothing before a decision', async () => {
    const r = await start(listener, { start_entity_id: cat.ids['album'] });
    expect(r.statusCode, r.body).toBe(201);
    const round = r.json<Round>();
    expect(round.items.length).toBeGreaterThan(0);
    // Only recordings of the album that this listener can play (r1, r2 have audio and rights).
    for (const i of round.items) expect([cat.ids['r1'], cat.ids['r2']]).toContain(i.recording_id);
    expect(round.items.every((i) => i.decision === null && i.reveal === null)).toBe(true);
    // No titles, artists, dates or popularity before a decision.
    expect(r.body).not.toMatch(/Test Album|Test Tones|"name"|release_date|popularity_tier/);
  });

  it('reveals the recording after Keep and saves it to the library; Pass reveals without saving', async () => {
    const round = (await start(listener, { start_entity_id: cat.ids['album'] })).json<Round>();
    const decide = (itemId: string, decision: string) =>
      h.api.inject({
        method: 'POST',
        url: `/v1/blind-digs/${round.blind_dig_id}/items/${itemId}/decision`,
        headers: listener.headers,
        payload: { decision },
      });
    const [first, second] = round.items;
    const kept = await decide(first!.item_id, 'keep');
    expect(kept.statusCode, kept.body).toBe(200);
    const keptItem = kept.json<Round>().items.find((i) => i.item_id === first!.item_id)!;
    expect(keptItem.reveal?.recording.entity_id).toBe(first!.recording_id);
    expect(keptItem.reveal?.release?.release_id).toBe(cat.ids['album']);
    expect(
      kept.json<Round>().items.find((i) => i.item_id === second?.item_id)?.reveal ?? null,
    ).toBeNull();

    const library = await h.api.inject({ url: '/v1/library', headers: listener.headers });
    expect(library.json().items.map((i: { ref_id: string }) => i.ref_id)).toContain(
      first!.recording_id,
    );

    // The same decision again is fine; changing it is not.
    expect((await decide(first!.item_id, 'keep')).statusCode).toBe(200);
    expect((await decide(first!.item_id, 'pass')).statusCode).toBe(409);
    if (second) {
      const passed = await decide(second.item_id, 'pass');
      expect(
        passed.json<Round>().items.find((i) => i.item_id === second.item_id)?.reveal,
      ).not.toBeNull();
    }
  });

  it('deals nothing the listener cannot play', async () => {
    const stranger = await h.user();
    const round = (await start(stranger, { start_entity_id: cat.ids['album'] })).json<Round>();
    expect(round.items).toEqual([]);
  });

  it('is private to its owner', async () => {
    const round = (await start(listener, { start_entity_id: cat.ids['album'] })).json<Round>();
    const other = await h.user();
    const url = `/v1/blind-digs/${round.blind_dig_id}`;
    expect((await h.api.inject({ url, headers: other.headers })).statusCode).toBe(404);
    const item = round.items[0]!;
    const d = await h.api.inject({
      method: 'POST',
      url: `${url}/items/${item.item_id}/decision`,
      headers: other.headers,
      payload: { decision: 'keep' },
    });
    expect(d.statusCode).toBe(404);
  });

  it('deals from the whole playable catalog without a start entity', async () => {
    const round = (await start(listener, { popularity: 'any' })).json<Round>();
    expect(round.items.length).toBeGreaterThan(0);
    expect(round.items.length).toBeLessThanOrEqual(10);
  });
});
