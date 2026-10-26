import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/**
 * Korean search quality (CQ-SRC-1): a judged query set. Each query names the result
 * listeners expect first; every case must hold. Add a case when a real query fails.
 */
let h: Harness;
let u: TestUser;
let ids: Record<string, string>;

const NAMES = ['새벽빛', '푸른 밤', '여름의 끝', '새벽의 노래', '파도 레코드'];

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  // The test database outlives runs: earlier copies of these names would tie.
  // Other tests' data with these names (or longer titles starting with them) would tie.
  await h.ctx.db
    .deleteFrom('search_document')
    .where((eb) => eb.or(NAMES.map((n) => eb('title', 'like', `${n}%`))))
    .execute();
  const res = await ingestCatalog(
    h.ctx,
    {
      source: `korean-search-${ulid().slice(-8).toLowerCase()}`,
      artists: [{ key: 'a', name: '새벽빛', aliases: ['Saebyeokbit', 'Dawnlight'] }],
      labels: [{ key: 'l', name: '파도 레코드', aliases: ['Pado Records'] }],
      recordings: [
        { key: 'night', title: '푸른 밤', artists: ['a'] },
        { key: 'summer', title: '여름의 끝', artists: ['a'] },
      ],
      releases: [
        {
          key: 'album',
          title: '새벽의 노래',
          type: 'album',
          label: 'l',
          artists: ['a'],
          tracks: ['night', 'summer'],
        },
      ],
    },
    () => Promise.reject(new Error('no audio')),
  );
  ids = res.ids;
  await h.worker.drain();
});
afterAll(() => h.close());

async function search(q: string) {
  const r = await h.api.inject({
    url: `/v1/search?q=${encodeURIComponent(q)}&scope=catalog`,
    headers: u.headers,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ items: { id: string; match: string; title: string }[] }>().items;
}

/** query → fixture key expected first, and why the case is here. */
const JUDGED: [string, string, string][] = [
  ['새벽빛', 'a', 'exact Korean name'],
  ['ㅅㅂㅂ', 'a', 'initial consonants'],
  ['새벽ㅂ', 'a', 'last syllable still being typed (initial only)'],
  ['새벽비', 'a', 'last syllable still being typed (no final consonant yet)'],
  ['새벽빗', 'a', 'one-jamo typo'],
  ['saebyeokbit', 'a', 'romanized alias'],
  ['Dawnlight', 'a', 'English alias'],
  ['푸른밤', 'night', 'spacing left out'],
  ['ㅍㄹㅂ', 'night', 'initials of a title'],
  ['여름의 끝', 'summer', 'exact title with a space'],
  ['ㅇㄹㅇ ㄲ', 'summer', 'initials with a space'],
  ['새벽의 노래', 'album', 'release title'],
  ['pado records', 'l', 'label alias, lowercase'],
];

describe('Korean search (CQ-SRC-1)', () => {
  it('puts the expected result first for every judged query', async () => {
    const misses: string[] = [];
    for (const [q, key, why] of JUDGED) {
      const items = await search(q);
      if (items[0]?.id !== ids[key]) {
        misses.push(`${q} (${why}): got ${items.map((i) => i.title).join(', ') || 'nothing'}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('calls Korean titles and aliases exact matches', async () => {
    expect((await search('새벽빛'))[0]?.match).toBe('exact');
    expect((await search('여름의 끝'))[0]?.match).toBe('exact');
    expect((await search('SAEBYEOKBIT'))[0]?.match).toBe('exact');
  });

  it('finds a track by its artist alias', async () => {
    const items = await search('saebyeokbit');
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([ids['night'], ids['summer']]));
  });

  it('computes initials in the database the same way for index and query', async () => {
    const r = await sql<{ a: string; b: string }>`
      SELECT rabit_initials('뉴진스 Super Shy!') AS a, rabit_initials('ㄴㅈㅅ') AS b`.execute(
      h.ctx.db,
    );
    expect(r.rows[0]).toEqual({ a: 'ㄴㅈㅅsupershy', b: 'ㄴㅈㅅ' });
  });
});
