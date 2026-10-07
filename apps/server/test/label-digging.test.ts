import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { asOperator } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

let h: Harness;
let u: TestUser;
let ids: Record<string, string>;
beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  const tag = ulid().slice(-6).toLowerCase();
  const rel = (key: string, title: string, artists: string[], date?: string) => ({
    key,
    title: `${title} ${tag}`,
    type: 'album' as const,
    label: 'tidal',
    artists,
    tracks: [`t_${key}`],
    ...(date ? { date } : {}),
  });
  ({ ids } = await ingestCatalog(
    h.ctx,
    {
      source: `label-dig-${tag}`,
      artists: [
        { key: 'early', name: `Early Band ${tag}` },
        { key: 'late', name: `Late Duo ${tag}` },
      ],
      people: [],
      labels: [{ key: 'tidal', name: `Tidal Room ${tag}` }],
      recordings: ['second', 'debut', 'return', 'archive'].map((k) => ({
        key: `t_${k}`,
        title: `Track ${k} ${tag}`,
        artists: ['early'],
      })),
      releases: [
        rel('second', 'Second Light', ['early', 'late'], '1997-03-01'),
        rel('debut', 'Debut', ['early'], '1994-05-20'),
        rel('return', 'Return', ['late'], '2003-09-09'),
        rel('archive', 'Archive Tapes', ['early']),
      ],
      credits: [],
      relations: [],
    },
    () => Promise.reject(new Error('no audio in this catalog')),
  ));
});
afterAll(() => h.close());

const timeline = (labelId: string) =>
  h.api.inject({ url: `/v1/dig/labels/${labelId}/timeline`, headers: u.headers });

describe('Label Digging, basic (DIG-011)', () => {
  it("lays a label's releases on a time axis with each artist's span", async () => {
    const r = await timeline(ids['tidal']!);
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    expect(body.label).toMatchObject({ entity_id: ids['tidal'], entity_type: 'label' });
    expect(body.years.map((y: { year: number | null }) => y.year)).toEqual([
      1994,
      1997,
      2003,
      null,
    ]);
    expect(body.years[1].releases[0]).toMatchObject({
      release_id: ids['second'],
      release_date: '1997-03-01',
      artists: [{ entity_id: ids['early'] }, { entity_id: ids['late'] }],
    });
    expect(body.artists).toEqual([
      expect.objectContaining({
        artist: expect.objectContaining({ entity_id: ids['early'] }),
        first_year: 1994,
        last_year: 1997,
        releases: 3,
      }),
      expect.objectContaining({
        artist: expect.objectContaining({ entity_id: ids['late'] }),
        first_year: 1997,
        last_year: 2003,
        releases: 2,
      }),
    ]);
    expect(body.truncated).toBe(false);
  });

  it('hides releases and artists excluded by a reviewed integrity decision', async () => {
    const ops = await asOperator(h);
    for (const subject of [ids['return'], ids['late']]) {
      const r = await h.api.inject({
        method: 'POST',
        url: '/v1/ops/integrity-signals',
        headers: ops.op.headers,
        payload: {
          subject_entity_id: subject,
          axis: 'recommendation_eligibility',
          value: 'excluded',
          reason: 'spam review',
        },
      });
      expect(r.statusCode).toBe(201);
    }
    const body = (await timeline(ids['tidal']!)).json();
    expect(body.years.map((y: { year: number | null }) => y.year)).toEqual([1994, 1997, null]);
    expect(body.artists.map((a: { artist: { entity_id: string } }) => a.artist.entity_id)).toEqual([
      ids['early'],
    ]);
  });

  it('answers 404 for anything that is not a label', async () => {
    expect((await timeline(ids['early']!)).statusCode).toBe(404);
    expect((await timeline('lbl_01ARZ3NDEKTSV4RRFFQ69G5FAV')).statusCode).toBe(404);
    expect((await timeline('not-an-id')).statusCode).toBe(404);
  });
});
