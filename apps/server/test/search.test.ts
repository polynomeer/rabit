import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { createHarness, uploadReady, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let alice: TestUser;
let bob: TestUser;
let tag: string;
let ids: Record<string, string>;

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user();
  bob = await h.user();
  tag = ulid().slice(-8).toLowerCase();
  const isrcSuffix = String(Date.now()).slice(-7);
  const res = await ingestCatalog(
    h.ctx,
    {
      source: `search-fixture-${tag}`,
      artists: [{ key: 'a', name: `Velvet Quasar ${tag}` }],
      people: [{ key: 'p', name: `Marguerite Okonkwo ${tag}` }],
      recordings: [
        { key: 'r', title: `Midnight Harbour ${tag}`, isrc: `KRA25${isrcSuffix}`, artists: ['a'] },
        { key: 'r2', title: `Morning Tide ${tag}`, artists: ['a'] },
      ],
      releases: [
        {
          key: 'rel',
          title: `Harbour Lights ${tag}`,
          type: 'album',
          upc: `88${isrcSuffix}000`,
          artists: ['a'],
          tracks: ['r', 'r2'],
        },
      ],
      credits: [{ subject: 'r', contributor: 'p', role: 'producer' }],
    },
    () => Promise.reject(new Error('no audio')),
  );
  ids = res.ids;
  await h.worker.drain();
});
afterAll(() => h.close());

async function search(u: TestUser, query: string, extra = '') {
  const r = await h.api.inject({
    url: `/v1/search?q=${encodeURIComponent(query)}${extra}`,
    headers: u.headers,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{
    items: { id: string; kind: string; match: string; scope: string; title: string }[];
    next_cursor: string | null;
  }>();
}

describe('catalog search (SRC-001, SRC-009)', () => {
  it('finds recordings, releases and artists by text', async () => {
    const r = await search(alice, `harbour ${tag}`);
    const found = r.items.map((i) => i.id);
    expect(found).toEqual(expect.arrayContaining([ids['r'], ids['rel']]));
    expect(r.items.every((i) => i.scope === 'catalog')).toBe(true);
  });

  it('ranks exact identity matches first', async () => {
    const isrc = (
      await h.ctx.db
        .selectFrom('recording')
        .select('isrc')
        .where('id', '=', ids['r']!)
        .executeTakeFirstOrThrow()
    ).isrc!;
    const r = await search(alice, isrc);
    expect(r.items[0]).toMatchObject({ id: ids['r'], match: 'exact' });
    const exactTitle = await search(alice, `Morning Tide ${tag}`);
    expect(exactTitle.items[0]).toMatchObject({ id: ids['r2'], match: 'exact' });
  });

  it('tolerates typos (fuzzy) and finds recordings by credited people', async () => {
    const r = await search(alice, `Velvet Quasr ${tag}`);
    expect(r.items.map((i) => i.id)).toContain(ids['a']);
    const credit = await search(alice, `Okonkwo ${tag}`);
    expect(credit.items.map((i) => i.id)).toEqual(expect.arrayContaining([ids['p'], ids['r']]));
  });

  it('filters by kind and pages with signed cursors', async () => {
    const onlyReleases = await search(alice, `harbour ${tag}`, '&types=release');
    expect(onlyReleases.items.map((i) => i.kind)).toEqual(['release']);
    const page1 = await search(alice, tag, '&limit=2');
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();
    const page2 = await search(
      alice,
      tag,
      `&limit=2&cursor=${encodeURIComponent(page1.next_cursor!)}`,
    );
    expect(page2.items.map((i) => i.id)).not.toEqual(
      expect.arrayContaining(page1.items.map((i) => i.id)),
    );
    const stolen = await h.api.inject({
      url: `/v1/search?q=${tag}&limit=2&cursor=${encodeURIComponent(page1.next_cursor!)}`,
      headers: bob.headers,
    });
    expect(stolen.statusCode).toBe(400);
  });

  it('validates input', async () => {
    expect((await h.api.inject({ url: '/v1/search?q=', headers: alice.headers })).statusCode).toBe(
      400,
    );
    expect(
      (await h.api.inject({ url: '/v1/search?q=x&types=bogus', headers: alice.headers }))
        .statusCode,
    ).toBe(400);
    expect(
      (await h.api.inject({ url: '/v1/search?q=x&mode=semantic', headers: alice.headers }))
        .statusCode,
    ).toBe(400);
    expect((await h.api.inject({ url: '/v1/search?q=x' })).statusCode).toBe(401);
  });
});

describe('private search (SRC-002/003, T05)', () => {
  let privateId: string;
  const secret = () => `Zanzibar Rehearsal ${tag}`;

  beforeAll(async () => {
    privateId = await uploadReady(h, alice, fixtures.wav(), { filename: `${secret()}.wav` });
  });

  it('finds the owner own audio and Audio Log notes', async () => {
    expect((await search(alice, secret())).items.map((i) => i.id)).toContain(privateId);
    expect((await search(alice, secret(), '&scope=mine')).items[0]).toMatchObject({
      id: privateId,
      scope: 'mine',
      kind: 'private_audio',
    });
    expect((await search(alice, secret(), '&scope=catalog')).items.map((i) => i.id)).not.toContain(
      privateId,
    );

    const log = await uploadReady(h, alice, fixtures.wav(), { intent: 'audio_log' });
    await h.api.inject({
      method: 'POST',
      url: '/v1/audio-logs',
      headers: alice.headers,
      payload: {
        audio_source_id: log,
        title: 'Voice memo',
        note: `bridge idea quokka${tag}`,
        recorded_at: new Date().toISOString(),
        recorded_tz: 'UTC',
        tags: [`tag${tag}`],
      },
    });
    await h.worker.drain();
    // Fixture names share a random tag, so fuzzy catalog hits may also appear; only own results are compared.
    const mine = async (q: string) =>
      (await search(alice, q, '&scope=mine')).items.map((i) => i.id);
    expect(await mine(`quokka${tag}`)).toEqual([log]);
    expect(await mine(`tag${tag}`)).toEqual([log]);
    expect((await search(bob, `quokka${tag}`)).items.filter((i) => i.scope === 'mine')).toEqual([]);
    expect((await search(bob, `quokka${tag}`)).items.map((i) => i.id)).not.toContain(log);
  });

  it("never returns another user's private audio, even for an exact title", async () => {
    for (const scope of ['all', 'mine', 'catalog']) {
      expect((await search(bob, secret(), `&scope=${scope}`)).items.map((i) => i.id)).not.toContain(
        privateId,
      );
    }
  });

  it('re-checks the canonical source: a corrupted index entry cannot leak (canary)', async () => {
    // Simulate index corruption: the document claims Bob's workspace.
    await h.ctx.db
      .updateTable('search_document')
      .set({ owner_workspace_id: bob.workspaceId })
      .where('id', '=', privateId)
      .execute();
    expect((await search(bob, secret())).items.map((i) => i.id)).not.toContain(privateId);
    await h.ctx.db
      .updateTable('search_document')
      .set({ owner_workspace_id: alice.workspaceId })
      .where('id', '=', privateId)
      .execute();
  });

  it('hides deleted audio immediately, before the index is cleaned', async () => {
    await h.api.inject({
      method: 'DELETE',
      url: `/v1/audio-sources/${privateId}`,
      headers: alice.headers,
    });
    expect((await search(alice, secret())).items.map((i) => i.id)).not.toContain(privateId);
    await h.worker.drain();
    const doc = await h.ctx.db
      .selectFrom('search_document')
      .select('id')
      .where('id', '=', privateId)
      .executeTakeFirst();
    expect(doc).toBeUndefined();
  });

  it('reindexes renamed audio', async () => {
    const id = await uploadReady(h, alice, fixtures.wav(), { filename: 'untitled.wav' });
    await h.api.inject({
      method: 'PATCH',
      url: `/v1/audio-sources/${id}`,
      headers: alice.headers,
      payload: { title: `Kestrel Demo ${tag}` },
    });
    await h.worker.drain();
    expect((await search(alice, `Kestrel Demo ${tag}`)).items[0]?.id).toBe(id);
  });
});

describe('account deletion removes private search documents', () => {
  it('purges the index for the deleted workspace', async () => {
    const u = await h.user();
    const id = await uploadReady(h, u, fixtures.wav(), { filename: `Ephemeral ${tag}.wav` });
    expect(
      await h.ctx.db
        .selectFrom('search_document')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst(),
    ).toBeDefined();
    await h.api.inject({ method: 'DELETE', url: '/v1/me', headers: u.headers });
    await h.worker.drain();
    const left = await h.ctx.db
      .selectFrom('search_document')
      .select('id')
      .where('owner_workspace_id', '=', u.workspaceId)
      .execute();
    expect(left).toEqual([]);
  });
});
