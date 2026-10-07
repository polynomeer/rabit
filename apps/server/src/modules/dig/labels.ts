import type { DbOrTx } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import { entitySummaries, type EntitySummary } from '../catalog/index.js';
import type { DigDeps } from './service.js';

/**
 * Label Digging, basic (DIG-011): a label's releases on a time axis, grouped by
 * year, and the artists it released over the years. Built only from stored
 * catalog data (label, release dates, release artists). Genre change, sub-labels
 * and scenes need data the catalog does not have yet and are left out.
 * Entities excluded by integrity decisions are hidden, as everywhere in DIG.
 */
const LIMIT = 1000;

export async function labelTimeline(
  db: DbOrTx,
  deps: Pick<DigDeps, 'excludedEntities'>,
  labelId: string,
) {
  const label = (await entitySummaries(db, [labelId])).get(labelId);
  if (!label || label.entity_type !== 'label') throw errors.notFound();

  const rows = await db
    .selectFrom('release')
    .select(['id', 'title', 'release_type', 'release_date'])
    .where('label_id', '=', labelId)
    .orderBy('release_date', (ob) => ob.asc().nullsLast())
    .orderBy('id')
    .limit(LIMIT + 1)
    .execute();
  const excluded = await deps.excludedEntities(
    db,
    rows.map((r) => r.id),
  );
  const releases = rows.slice(0, LIMIT).filter((r) => !excluded.has(r.id));

  const credits = releases.length
    ? await db
        .selectFrom('release_artist')
        .select(['release_id', 'artist_id', 'ord'])
        .where(
          'release_id',
          'in',
          releases.map((r) => r.id),
        )
        .orderBy('ord')
        .execute()
    : [];
  const hiddenArtists = await deps.excludedEntities(
    db,
    credits.map((c) => c.artist_id),
  );
  const visible = credits.filter((c) => !hiddenArtists.has(c.artist_id));
  const artists = await entitySummaries(
    db,
    visible.map((c) => c.artist_id),
  );
  const byRelease = new Map<string, EntitySummary[]>();
  for (const c of visible) {
    const a = artists.get(c.artist_id);
    if (a) byRelease.set(c.release_id, [...(byRelease.get(c.release_id) ?? []), a]);
  }

  const yearOf = (date: string | null) => (date ? Number(date.slice(0, 4)) : null);
  const years = new Map<number | null, typeof releases>();
  for (const r of releases) {
    const y = yearOf(r.release_date);
    years.set(y, [...(years.get(y) ?? []), r]);
  }

  // Each artist's span on this label, in order of first appearance.
  const span = new Map<string, { first: number | null; last: number | null; count: number }>();
  for (const r of releases) {
    const y = yearOf(r.release_date);
    for (const a of byRelease.get(r.id) ?? []) {
      const s = span.get(a.entity_id) ?? { first: y, last: y, count: 0 };
      s.count += 1;
      if (y !== null) {
        s.first = s.first === null ? y : Math.min(s.first, y);
        s.last = s.last === null ? y : Math.max(s.last, y);
      }
      span.set(a.entity_id, s);
    }
  }

  return {
    label,
    years: [...years.entries()].map(([year, list]) => ({
      year,
      releases: list.map((r) => ({
        release_id: r.id,
        title: r.title,
        release_type: r.release_type,
        release_date: r.release_date,
        artists: byRelease.get(r.id) ?? [],
      })),
    })),
    artists: [...span.entries()].map(([id, s]) => ({
      artist: artists.get(id) as EntitySummary,
      first_year: s.first,
      last_year: s.last,
      releases: s.count,
    })),
    truncated: rows.length > LIMIT,
  };
}
