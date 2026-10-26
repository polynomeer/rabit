import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { Basis, ReleaseDatePrecision, VerificationState } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import { artworkUrls, cutoffDate, entitySummaries, type EntitySummary } from '../catalog/index.js';
import type { DigDeps } from './service.js';

/**
 * Artist Journey (EX-02) and album compare (EX-03): an artist's releases and
 * dated relations in date order, built only from stored catalog facts. Dates keep
 * their precision (ADR-0033); releases without a known date or precision are
 * listed apart instead of being guessed into the order.
 *
 * The historical view (`cutoff`) keeps only what was out by the cutoff: releases
 * whose last possible day is on or before it and relations that began by then.
 * Undated items cannot be placed before a cutoff, so that view leaves them out
 * and only counts them. Editorial text is not part of either view yet (D02).
 */
const LIMIT = 500;
const EVENT_TYPES = ['member_of', 'signed_to'] as const;

export interface Evidence {
  basis: Basis;
  verification_state: VerificationState;
  source: string;
  confidence: number | null;
}

/** Catalog structure comes from the ingest source: declared, not verified. */
const CATALOG: Evidence = {
  basis: 'declared',
  verification_state: 'self_declared',
  source: 'catalog',
  confidence: null,
};

interface ReleaseRow {
  id: string;
  title: string;
  release_type: 'album' | 'single' | 'ep' | 'compilation';
  label_id: string | null;
  release_date: string | null;
  release_date_precision: ReleaseDatePrecision | null;
  release_date_latest: string | null;
  ord: number;
}

async function artistOrNotFound(db: DbOrTx, deps: Pick<DigDeps, 'excludedEntities'>, id: string) {
  const artist = (await entitySummaries(db, [id])).get(id);
  if (!artist || artist.entity_type !== 'artist') throw errors.notFound();
  if ((await deps.excludedEntities(db, [id])).has(id)) throw errors.notFound();
  return artist;
}

/** Track count and total length per release. */
async function trackStats(db: DbOrTx, releaseIds: string[]) {
  if (!releaseIds.length) return new Map<string, { tracks: number; duration_ms: number | null }>();
  const rows = await db
    .selectFrom('release_track as rt')
    .innerJoin('recording as r', 'r.id', 'rt.recording_id')
    .where('rt.release_id', 'in', releaseIds)
    .groupBy('rt.release_id')
    .select([
      'rt.release_id',
      sql<number>`count(*)::int`.as('tracks'),
      // Unknown when any track has no length, rather than a short total.
      sql<number | null>`CASE WHEN bool_and(r.duration_ms IS NOT NULL)
        THEN sum(r.duration_ms)::int END`.as('duration_ms'),
    ])
    .execute();
  return new Map(rows.map((r) => [r.release_id, { tracks: r.tracks, duration_ms: r.duration_ms }]));
}

function releaseView(
  r: ReleaseRow,
  labels: Map<string, EntitySummary>,
  stats: Map<string, { tracks: number; duration_ms: number | null }>,
  covers: Map<string, Record<string, string>>,
) {
  return {
    release_id: r.id,
    title: r.title,
    release_type: r.release_type,
    release_date: r.release_date_precision ? r.release_date : null,
    date_precision: r.release_date_precision,
    /** `main` for the first-listed artist, `with` for other listed artists. */
    role: r.ord === 0 ? ('main' as const) : ('with' as const),
    label: (r.label_id && labels.get(r.label_id)) || null,
    tracks: stats.get(r.id)?.tracks ?? 0,
    duration_ms: stats.get(r.id)?.duration_ms ?? null,
    artwork: covers.get(r.id) ?? null,
    evidence: CATALOG,
  };
}

export async function artistJourney(
  ctx: AppContext,
  deps: Pick<DigDeps, 'excludedEntities'>,
  artistId: string,
  q: { cutoff_at?: Date | undefined; time_zone: string },
) {
  const db = ctx.db;
  const artist = await artistOrNotFound(db, deps, artistId);
  const cutoff = q.cutoff_at ? cutoffDate(q.cutoff_at, q.time_zone) : null;

  const rows: ReleaseRow[] = await db
    .selectFrom('release_artist as ra')
    .innerJoin('release as r', 'r.id', 'ra.release_id')
    .where('ra.artist_id', '=', artistId)
    .select([
      'r.id',
      'r.title',
      'r.release_type',
      'r.label_id',
      'r.release_date',
      'r.release_date_precision',
      'r.release_date_latest',
      'ra.ord',
    ])
    .orderBy('r.release_date_latest', (ob) => ob.asc().nullsLast())
    .orderBy('r.id')
    .limit(LIMIT + 1)
    .execute();
  const excluded = await deps.excludedEntities(
    db,
    rows.map((r) => r.id),
  );
  const all = rows.slice(0, LIMIT).filter((r) => !excluded.has(r.id));
  const dated = all.filter(
    (r): r is ReleaseRow & { release_date_latest: string } => r.release_date_latest !== null,
  );
  const undated = all.filter((r) => r.release_date_latest === null);
  const shown = cutoff ? dated.filter((r) => r.release_date_latest <= cutoff) : dated;

  const relations = await db
    .selectFrom('music_relation')
    .select([
      'id',
      'from_entity_id',
      'to_entity_id',
      'relation_type',
      'valid_from',
      'valid_to',
      'basis',
      'verification_state',
      'source',
      'confidence',
    ])
    .where((eb) => eb.or([eb('from_entity_id', '=', artistId), eb('to_entity_id', '=', artistId)]))
    .where('relation_type', 'in', EVENT_TYPES)
    .orderBy('valid_from', (ob) => ob.asc().nullsLast())
    .orderBy('id')
    .limit(LIMIT)
    .execute();
  const others = relations.map((r) =>
    r.from_entity_id === artistId ? r.to_entity_id : r.from_entity_id,
  );
  const hiddenOthers = await deps.excludedEntities(db, others);
  const visibleRelations = relations.filter((_, i) => !hiddenOthers.has(others[i] ?? ''));
  const datedEvents = visibleRelations.flatMap((r) =>
    r.valid_from === null ? [] : [{ ...r, valid_from: r.valid_from }],
  );
  const events = cutoff ? datedEvents.filter((r) => r.valid_from <= cutoff) : datedEvents;

  const releasesOut = cutoff ? shown : [...shown, ...undated];
  const [entities, stats, covers] = await Promise.all([
    entitySummaries(db, [
      ...releasesOut.flatMap((r) => (r.label_id ? [r.label_id] : [])),
      ...events.map((r) => (r.from_entity_id === artistId ? r.to_entity_id : r.from_entity_id)),
    ]),
    trackStats(
      db,
      releasesOut.map((r) => r.id),
    ),
    artworkUrls(
      ctx,
      releasesOut.map((r) => r.id),
    ),
  ]);

  const items = [
    ...shown.map((r) => ({
      sort: r.release_date_latest,
      id: r.id,
      item: { kind: 'release' as const, release: releaseView(r, entities, stats, covers) },
    })),
    ...events.flatMap((r) => {
      const otherId = r.from_entity_id === artistId ? r.to_entity_id : r.from_entity_id;
      const other = entities.get(otherId);
      if (!other) return [];
      return [
        {
          sort: r.valid_from,
          id: r.id,
          item: {
            kind: 'event' as const,
            event: {
              relation_id: r.id,
              relation_type: r.relation_type,
              /** `outgoing`: the artist is the subject (joined a group, signed to a label). */
              direction:
                r.from_entity_id === artistId ? ('outgoing' as const) : ('incoming' as const),
              other,
              valid_from: r.valid_from,
              valid_to: r.valid_to && (!cutoff || r.valid_to <= cutoff) ? r.valid_to : null,
              evidence: {
                basis: r.basis,
                verification_state: r.verification_state,
                source: r.source,
                confidence: r.confidence,
              },
            },
          },
        },
      ];
    }),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.id < b.id ? -1 : 1));

  return {
    artist,
    view: cutoff ? ('historical' as const) : ('modern' as const),
    cutoff,
    timeline: items.map((i) => i.item),
    undated: cutoff ? [] : undated.map((r) => releaseView(r, entities, stats, covers)),
    coverage: {
      releases: all.length,
      dated: dated.length,
      undated: undated.length,
      after_cutoff: cutoff ? dated.length - shown.length : 0,
      undated_events: visibleRelations.length - datedEvents.length,
    },
    truncated: rows.length > LIMIT,
  };
}

/**
 * Two releases of one artist side by side (EX-03): catalog facts only, each with
 * its source. Producers come from credits on the release or its tracks; guests are
 * the other artists listed on the release or its tracks.
 */
export async function compareReleases(
  ctx: AppContext,
  deps: Pick<DigDeps, 'excludedEntities'>,
  artistId: string,
  releaseA: string,
  releaseB: string,
) {
  const db = ctx.db;
  const artist = await artistOrNotFound(db, deps, artistId);
  if (releaseA === releaseB) {
    throw errors.validation({ release_b: 'must differ from release_a' });
  }
  const ids = [releaseA, releaseB];
  const rows = await db
    .selectFrom('release as r')
    .leftJoin('release_artist as ra', (j) =>
      j.onRef('ra.release_id', '=', 'r.id').on('ra.artist_id', '=', artistId),
    )
    .where('r.id', 'in', ids)
    .select([
      'r.id',
      'r.title',
      'r.release_type',
      'r.label_id',
      'r.release_date',
      'r.release_date_precision',
      'r.release_date_latest',
      'ra.ord',
    ])
    .execute();
  const excluded = await deps.excludedEntities(db, ids);
  const byId = new Map(rows.filter((r) => !excluded.has(r.id)).map((r) => [r.id, r]));
  if (byId.size !== 2) throw errors.notFound();
  if ([...byId.values()].some((r) => r.ord === null)) {
    throw errors.unprocessable('UNPROCESSABLE', 'Both releases must be by this artist.');
  }

  const tracks = await db
    .selectFrom('release_track')
    .select(['release_id', 'recording_id'])
    .where('release_id', 'in', ids)
    .execute();
  const recordingsOf = (id: string) =>
    tracks.filter((t) => t.release_id === id).map((t) => t.recording_id);
  const subjects = [...ids, ...tracks.map((t) => t.recording_id)];

  const [producerRows, guestRows, releaseGuests] = await Promise.all([
    db
      .selectFrom('credit')
      .select([
        'subject_entity_id',
        'contributor_entity_id',
        'basis',
        'verification_state',
        'source',
      ])
      .where('subject_entity_id', 'in', subjects)
      .where('role', '=', 'producer')
      .execute(),
    tracks.length
      ? db
          .selectFrom('recording_artist')
          .select(['recording_id', 'artist_id'])
          .where(
            'recording_id',
            'in',
            tracks.map((t) => t.recording_id),
          )
          .where('artist_id', '!=', artistId)
          .execute()
      : Promise.resolve([]),
    db
      .selectFrom('release_artist')
      .select(['release_id', 'artist_id'])
      .where('release_id', 'in', ids)
      .where('artist_id', '!=', artistId)
      .execute(),
  ]);
  const people = [
    ...producerRows.map((c) => c.contributor_entity_id),
    ...guestRows.map((g) => g.artist_id),
    ...releaseGuests.map((g) => g.artist_id),
  ];
  const hidden = await deps.excludedEntities(db, people);
  const [entities, stats, covers] = await Promise.all([
    entitySummaries(db, [
      ...people.filter((p) => !hidden.has(p)),
      ...[...byId.values()].flatMap((r) => (r.label_id ? [r.label_id] : [])),
    ]),
    trackStats(db, ids),
    artworkUrls(ctx, ids),
  ]);

  const side = (id: string) => {
    const r = byId.get(id);
    if (!r) throw errors.notFound();
    const subjectsOf = new Set([id, ...recordingsOf(id)]);
    const producers = new Map<string, { entity: EntitySummary; evidence: Evidence }>();
    for (const c of producerRows) {
      const e = entities.get(c.contributor_entity_id);
      if (!subjectsOf.has(c.subject_entity_id) || !e || producers.has(e.entity_id)) continue;
      producers.set(e.entity_id, {
        entity: e,
        evidence: {
          basis: c.basis,
          verification_state: c.verification_state,
          source: c.source,
          confidence: null,
        },
      });
    }
    const guestIds = new Set([
      ...releaseGuests.filter((g) => g.release_id === id).map((g) => g.artist_id),
      ...guestRows.filter((g) => subjectsOf.has(g.recording_id)).map((g) => g.artist_id),
    ]);
    const guests = [...guestIds].flatMap((g) => {
      const e = entities.get(g);
      return e ? [e] : [];
    });
    return {
      ...releaseView({ ...r, ord: r.ord ?? 0 }, entities, stats, covers),
      producers: [...producers.values()],
      guests,
    };
  };
  const a = side(releaseA);
  const b = side(releaseB);
  const ids2 = (list: { entity_id: string }[]) => new Set(list.map((e) => e.entity_id));
  const both = (x: { entity_id: string }[], y: { entity_id: string }[]) => {
    const s = ids2(y);
    return x.filter((e) => s.has(e.entity_id));
  };
  return {
    artist,
    releases: [a, b],
    shared: {
      producers: both(
        a.producers.map((p) => p.entity),
        b.producers.map((p) => p.entity),
      ),
      guests: both(a.guests, b.guests),
      label: a.label && b.label && a.label.entity_id === b.label.entity_id ? a.label : null,
    },
  };
}
