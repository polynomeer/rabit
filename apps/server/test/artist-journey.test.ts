import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCatalog, type CatalogManifest } from '../src/modules/catalog/index.js';
import { clearFlagCache } from '../src/modules/flags/index.js';
import { ulid } from '../src/platform/ids.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Artist Journey (EX-02) and album compare (EX-03). */
let h: Harness;
let ids: Record<string, string>;
let u: TestUser;
let op: TestUser;

const flag = async (key: string, enabled: boolean) => {
  const r = await h.api.inject({
    method: 'PUT',
    url: `/v1/ops/features/${key}`,
    headers: op.headers,
    payload: { override: { enabled, rollout_percent: 100 }, reason: 'journey test' },
  });
  expect(r.statusCode, r.body).toBe(200);
  clearFlagCache();
};

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  op = await h.user({ operator: true });
  const tag = ulid().slice(-6).toLowerCase();
  const manifest: CatalogManifest = {
    source: `journey-${tag}`,
    artists: [
      { key: 'mira', name: `Mira ${tag}` },
      { key: 'ferry', name: `Quiet Ferry ${tag}` },
      { key: 'other', name: `Someone Else ${tag}` },
    ],
    people: [{ key: 'jun', name: `Jun ${tag}` }],
    labels: [
      { key: 'tide', name: `Tidewater ${tag}` },
      { key: 'low', name: `Lowlight ${tag}` },
    ],
    recordings: [
      { key: 't1', title: `Paper Boats ${tag}`, artists: ['mira'] },
      { key: 't2', title: `First Light ${tag}`, artists: ['mira', 'ferry'] },
      { key: 't3', title: `Salt ${tag}`, artists: ['mira'] },
      { key: 't4', title: `Demo ${tag}`, artists: ['mira'] },
      { key: 't5', title: `Elsewhere ${tag}`, artists: ['other'] },
    ],
    releases: [
      {
        key: 'debut',
        title: 'Paper Boats',
        type: 'single',
        label: 'tide',
        date: '2009-05-02',
        artists: ['mira'],
        tracks: ['t1'],
      },
      {
        key: 'lp1',
        title: 'First Light',
        type: 'album',
        label: 'tide',
        date: '2011-03-09',
        artists: ['mira'],
        tracks: ['t1', 't2'],
      },
      {
        key: 'ep',
        title: 'Salt',
        type: 'ep',
        label: 'low',
        date: '2014-01-01',
        date_precision: 'year',
        artists: ['mira'],
        tracks: ['t3'],
      },
      { key: 'demos', title: 'Demos', type: 'ep', artists: ['mira'], tracks: ['t4'] },
      {
        key: 'theirs',
        title: 'Elsewhere',
        type: 'single',
        date: '2012-01-01',
        artists: ['other'],
        tracks: ['t5'],
      },
    ],
    relations: [
      {
        from: 'mira',
        to: 'low',
        type: 'signed_to',
        basis: 'declared',
        verification_state: 'distributor_verified',
      },
      {
        from: 'mira',
        to: 'ferry',
        type: 'member_of',
        basis: 'declared',
        verification_state: 'self_declared',
      },
    ],
    claims: [],
    credits: [
      {
        subject: 'lp1',
        contributor: 'jun',
        role: 'producer',
        creation_method: 'human',
        basis: 'declared',
        verification_state: 'self_declared',
      },
      {
        subject: 't3',
        contributor: 'jun',
        role: 'producer',
        creation_method: 'human',
        basis: 'declared',
        verification_state: 'self_declared',
      },
    ],
    grants: [],
  };
  ids = (await ingestCatalog(h.ctx, manifest, () => Promise.reject(new Error('no audio')))).ids;
  // Signed in 2012; the membership has no date.
  await h.ctx.db
    .updateTable('music_relation')
    .set({ valid_from: '2012-08-01' })
    .where('from_entity_id', '=', ids['mira']!)
    .where('relation_type', '=', 'signed_to')
    .execute();
  await flag('exploration_journey', true);
  await flag('exploration_compare', true);
});
afterAll(async () => {
  await h.ctx.db
    .deleteFrom('feature_flag')
    .where('key', 'in', ['exploration_journey', 'exploration_compare'])
    .execute();
  clearFlagCache();
  await h.close();
});

type Journey = {
  view: string;
  cutoff: string | null;
  timeline: (
    | {
        kind: 'release';
        release: {
          release_id: string;
          release_date: string | null;
          date_precision: string;
          tracks: number;
          label: { entity_id: string } | null;
        };
      }
    | {
        kind: 'event';
        event: {
          relation_type: string;
          other: { entity_id: string };
          valid_from: string;
          evidence: { verification_state: string };
        };
      }
  )[];
  undated: { release_id: string; date_precision: string | null }[];
  coverage: Record<string, number>;
};
const journey = (query = '', who = u) =>
  h.api.inject({ url: `/v1/dig/artists/${ids['mira']}/journey${query}`, headers: who.headers });
const keys = (j: Journey) =>
  j.timeline.map((i) =>
    i.kind === 'release'
      ? Object.entries(ids).find(([, id]) => id === i.release.release_id)![0]
      : `event:${i.event.relation_type}`,
  );

describe('Artist Journey', () => {
  it('lists releases and dated relations in date order, undated apart', async () => {
    const r = await journey();
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json<Journey>();
    expect(j.view).toBe('modern');
    expect(keys(j)).toEqual(['debut', 'lp1', 'event:signed_to', 'ep']);
    expect(j.undated.map((x) => x.release_id)).toEqual([ids['demos']]);
    const ep = j.timeline.find((i) => i.kind === 'release' && i.release.release_id === ids['ep']);
    // Shown with the precision it has, never as 1 January.
    expect(ep).toMatchObject({ release: { release_date: '2014-01-01', date_precision: 'year' } });
    const lp1 = j.timeline.find((i) => i.kind === 'release' && i.release.release_id === ids['lp1']);
    expect(lp1).toMatchObject({ release: { tracks: 2, label: { entity_id: ids['tide'] } } });
    expect(j.timeline[2]).toMatchObject({
      event: {
        other: { entity_id: ids['low'] },
        valid_from: '2012-08-01',
        evidence: { verification_state: 'distributor_verified' },
      },
    });
    expect(j.coverage).toMatchObject({ releases: 4, dated: 3, undated: 1, undated_events: 1 });
  });

  it('keeps only what was out by the cutoff in the historical view', async () => {
    // Mid-2014: the year-only EP could still be unreleased, so it is left out.
    const mid = (await journey('?cutoff_at=2014-06-15T12:00:00%2B09:00')).json<Journey>();
    expect(mid).toMatchObject({ view: 'historical', cutoff: '2014-06-15' });
    expect(keys(mid)).toEqual(['debut', 'lp1', 'event:signed_to']);
    expect(mid.undated).toEqual([]);
    expect(mid.coverage).toMatchObject({ after_cutoff: 1, undated: 1 });

    const end = (await journey('?cutoff_at=2014-12-31T23:00:00Z&time_zone=UTC')).json<Journey>();
    expect(keys(end)).toContain('ep');
    const before = (await journey('?cutoff_at=2012-07-31T00:00:00Z&time_zone=UTC')).json<Journey>();
    expect(keys(before)).toEqual(['debut', 'lp1']);
  });

  it('uses the time zone to find the cutoff date', async () => {
    // 2014-12-31T20:00Z is already 2015-01-01 in Seoul.
    const seoul = (await journey('?cutoff_at=2014-12-31T20:00:00Z')).json<Journey>();
    expect(seoul.cutoff).toBe('2015-01-01');
    const la = (
      await journey('?cutoff_at=2014-12-31T20:00:00Z&time_zone=America/Los_Angeles')
    ).json<Journey>();
    expect(la.cutoff).toBe('2014-12-31');
  });

  it('validates input and hides unknown artists and non-artists', async () => {
    expect((await journey('?time_zone=Mars/Base')).statusCode).toBe(400);
    expect((await journey('?cutoff_at=2014')).statusCode).toBe(400);
    const label = await h.api.inject({
      url: `/v1/dig/artists/${ids['tide']}/journey`,
      headers: u.headers,
    });
    expect(label.statusCode).toBe(404);
    const unauth = await h.api.inject({ url: `/v1/dig/artists/${ids['mira']}/journey` });
    expect(unauth.statusCode).toBe(401);
  });

  it('is hidden while its flag is off', async () => {
    await flag('exploration_journey', false);
    expect((await journey()).statusCode).toBe(404);
    await flag('exploration_journey', true);
  });
});

describe('album compare', () => {
  const compare = (a: string, b: string) =>
    h.api.inject({
      url: `/v1/dig/artists/${ids['mira']}/compare?release_a=${ids[a]}&release_b=${ids[b]}`,
      headers: u.headers,
    });

  it('puts two releases of the artist side by side with their sources', async () => {
    const r = await compare('lp1', 'ep');
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json<{
      releases: {
        release_id: string;
        tracks: number;
        producers: { entity: { entity_id: string }; evidence: { source: string } }[];
        guests: { entity_id: string }[];
        label: { entity_id: string } | null;
      }[];
      shared: { producers: { entity_id: string }[]; guests: unknown[]; label: unknown };
    }>();
    const [lp1, ep] = c.releases;
    expect(lp1).toMatchObject({
      release_id: ids['lp1'],
      tracks: 2,
      label: { entity_id: ids['tide'] },
    });
    expect(lp1!.producers.map((p) => p.entity.entity_id)).toEqual([ids['jun']]);
    expect(lp1!.guests.map((g) => g.entity_id)).toEqual([ids['ferry']]);
    // The EP's producer comes from a track credit.
    expect(ep!.producers.map((p) => p.entity.entity_id)).toEqual([ids['jun']]);
    expect(ep!.guests).toEqual([]);
    expect(c.shared).toEqual({
      producers: [expect.objectContaining({ entity_id: ids['jun'] })],
      guests: [],
      label: null,
    });
  });

  it('refuses releases of another artist and the same release twice', async () => {
    const r = await compare('lp1', 'theirs');
    expect(r.statusCode).toBe(422);
    expect((await compare('lp1', 'lp1')).statusCode).toBe(400);
  });

  it('is hidden while its flag is off', async () => {
    await flag('exploration_compare', false);
    expect((await compare('lp1', 'ep')).statusCode).toBe(404);
    await flag('exploration_compare', true);
  });
});
