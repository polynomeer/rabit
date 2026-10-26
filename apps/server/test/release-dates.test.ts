import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cutoffDate,
  datePrecise,
  ingestCatalog,
  isTimeZone,
  recordingsOutBy,
  type CatalogManifest,
} from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { createHarness, type Harness } from './helpers/harness.js';

/** Release date precision and the cutoff rule (ADR-0033). */
let h: Harness;
let ids: Record<string, string>;
beforeAll(async () => {
  h = await createHarness();
  const tag = ulid().slice(-6).toLowerCase();
  const manifest: CatalogManifest = {
    source: `release-dates-${tag}`,
    artists: [{ key: 'a', name: `Date Band ${tag}` }],
    people: [],
    labels: [],
    recordings: ['day', 'month', 'year', 'reissued', 'late', 'undated'].map((k) => ({
      key: k,
      title: `${k} ${tag}`,
      artists: ['a'],
    })),
    releases: [
      // A full date with no precision given is a day.
      {
        key: 'r-day',
        title: 'Day',
        type: 'single',
        date: '1983-04-21',
        artists: ['a'],
        tracks: ['day'],
      },
      {
        key: 'r-month',
        title: 'Month',
        type: 'single',
        date: '1983-06-01',
        date_precision: 'month',
        artists: ['a'],
        tracks: ['month'],
      },
      {
        key: 'r-year',
        title: 'Year',
        type: 'single',
        date: '1983-01-01',
        date_precision: 'year',
        artists: ['a'],
        tracks: ['year'],
      },
      // `reissued` first came out in 1982; the 2010 remaster does not move it.
      {
        key: 'r-orig',
        title: 'Original',
        type: 'album',
        date: '1982-11-02',
        artists: ['a'],
        tracks: ['reissued'],
      },
      {
        key: 'r-remaster',
        title: 'Remaster',
        type: 'compilation',
        date: '2010-05-05',
        artists: ['a'],
        tracks: ['reissued', 'late'],
      },
      { key: 'r-undated', title: 'Undated', type: 'single', artists: ['a'], tracks: ['undated'] },
    ],
    relations: [],
    claims: [],
    credits: [],
    grants: [],
  };
  ids = (await ingestCatalog(h.ctx, manifest, () => Promise.reject(new Error('no audio')))).ids;
});
afterAll(() => h.close());

const rec = (...keys: string[]) => keys.map((k) => ids[k]!);
const outBy = async (cutoff: string) => {
  const out = await recordingsOutBy(
    h.ctx.db,
    rec('day', 'month', 'year', 'reissued', 'late', 'undated'),
    cutoff,
  );
  return Object.fromEntries(
    Object.entries(ids)
      .filter(([, id]) => out.has(id))
      .map(([k, id]) => [k, out.get(id)]),
  );
};

describe('release date precision (ADR-0033)', () => {
  it('stores the precision and the last possible day', async () => {
    const rows = await h.ctx.db
      .selectFrom('release')
      .where('id', 'in', [ids['r-day']!, ids['r-month']!, ids['r-year']!, ids['r-undated']!])
      .select(['id', 'release_date_precision', 'release_date_latest'])
      .execute();
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[ids['r-day']!]).toMatchObject({ release_date_precision: 'day' });
    expect(by[ids['r-day']!]!.release_date_latest).toBe('1983-04-21');
    expect(by[ids['r-month']!]!.release_date_precision).toBe('month');
    expect(by[ids['r-year']!]!.release_date_precision).toBe('year');
    expect(by[ids['r-undated']!]).toMatchObject({
      release_date_precision: null,
      release_date_latest: null,
    });
  });

  it('counts a release as out only from its last possible day', async () => {
    expect(await outBy('1983-06-15')).toEqual({
      day: '1983-04-21',
      reissued: '1982-11-02',
    });
    expect(Object.keys(await outBy('1983-06-30')).sort()).toEqual(['day', 'month', 'reissued']);
    expect(await outBy('1983-12-31')).toMatchObject({ year: '1983-12-31', month: '1983-06-30' });
  });

  it('dates a recording by its earliest release and never counts undated ones', async () => {
    const at2009 = await outBy('2009-12-31');
    expect(at2009).not.toHaveProperty('late');
    expect(at2009).not.toHaveProperty('undated');
    const at2026 = await outBy('2026-10-26');
    expect(at2026).toMatchObject({ reissued: '1982-11-02', late: '2010-05-05' });
    expect(at2026).not.toHaveProperty('undated');
  });

  it('refuses a precision without a date', async () => {
    await expect(
      h.ctx.db
        .updateTable('release')
        .set({ release_date_precision: 'day' })
        .where('id', '=', ids['r-undated']!)
        .execute(),
    ).rejects.toThrow(/release_precision_needs_date/);
  });
});

describe('cutoff helpers', () => {
  it('takes the calendar date in the chosen time zone', () => {
    const at = new Date('1983-06-15T20:00:00Z');
    expect(cutoffDate(at, 'UTC')).toBe('1983-06-15');
    expect(cutoffDate(at, 'Asia/Tokyo')).toBe('1983-06-16');
    expect(cutoffDate(at, 'America/Los_Angeles')).toBe('1983-06-15');
    expect(isTimeZone('Asia/Seoul')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });

  it('never shows a date with more precision than stored (EXP-024)', () => {
    expect(datePrecise('1983-04-21', 'day')).toBe('1983-04-21');
    expect(datePrecise('1983-06-01', 'month')).toBe('1983-06');
    expect(datePrecise('1983-01-01', 'year')).toBe('1983');
    expect(datePrecise('1983-01-01', null)).toBeNull();
    expect(datePrecise(null, null)).toBeNull();
  });
});
