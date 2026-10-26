import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { ReleaseDatePrecision, TimeMachineContext } from '../../platform/db/schema.js';
import type { Principal } from '../../platform/http/principal.js';
import { metrics } from '../../platform/metrics.js';
import {
  cutoffDate,
  entitySummaries,
  recordingSources,
  recordingsOutBy,
} from '../catalog/index.js';
import { playabilities } from '../playback/index.js';
import { popularityOf, POPULARITY_CEILING } from './connections.js';
import type { DigDeps } from './service.js';

/**
 * Time Radio candidates (ADR-0034): catalog recordings out by the cutoff date
 * (ADR-0033: the earliest release containing them, by its last possible day) that
 * the listener can play now. Recordings of the five years up to the cutoff come
 * first, so 1983 sounds like 1983 rather than like everything before it. `hidden`
 * keeps recordings that are less played on Rabit now; that is a statement about
 * today's listening, never about how known they were then (EXP-026).
 *
 * Every pick is checked against the cutoff again before it is returned; a pick that
 * fails is dropped and counted (`rabit_time_machine_cutoff_violations_total`, which
 * must stay 0).
 */
export interface TimeMachineReason {
  code: 'time_machine';
  /** The main artist, for the reason line. */
  name: string | null;
  basis: 'declared';
  /** The earliest release containing the recording, at its stored precision. */
  release_date: string;
  date_precision: ReleaseDatePrecision;
  cutoff: string;
}

const PER_ARTIST = 2;
const POOL = 400;
const RECENT_YEARS = 5;

function yearsBefore(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) - years).padStart(4, '0')}${date.slice(4)}`;
}

export async function timeMachineFor(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  context: TimeMachineContext,
  opts: { exclude: ReadonlySet<string>; size: number; nonce?: string },
): Promise<{ recording_id: string; reason: TimeMachineReason }[]> {
  const db = ctx.db;
  const cutoff = cutoffDate(new Date(context.cutoff_at), context.time_zone);
  const recentFrom = yearsBefore(cutoff, RECENT_YEARS);
  const nonce = `${cutoff}:${opts.nonce ?? ''}`;

  // Recent years first, then random within each group (stable for a nonce).
  const pool = await sql<{ recording_id: string; first_latest: string }>`
    SELECT f.recording_id, f.first_latest::text AS first_latest
    FROM (
      SELECT rt.recording_id, min(r.release_date_latest) AS first_latest
      FROM release_track rt JOIN release r ON r.id = rt.release_id
      WHERE r.release_date_latest IS NOT NULL
      GROUP BY rt.recording_id
      HAVING min(r.release_date_latest) <= ${cutoff}::date
    ) f
    JOIN recording rec ON rec.id = f.recording_id
    WHERE rec.catalog_audio_source_id IS NOT NULL
    ORDER BY (f.first_latest > ${recentFrom}::date) DESC, md5(f.recording_id || ${nonce})
    LIMIT ${POOL}`.execute(db);
  const candidates = pool.rows.filter((r) => !opts.exclude.has(r.recording_id));
  const ids = candidates.map((c) => c.recording_id);
  if (ids.length === 0) {
    metrics.timeMachineCandidates.inc({ mode: context.mode, outcome: 'empty' });
    return [];
  }

  const [sources, excluded, mainArtists, popularity] = await Promise.all([
    recordingSources(db, ids),
    deps.excludedEntities(db, ids),
    db
      .selectFrom('recording_artist')
      .select(['recording_id', 'artist_id'])
      .where('recording_id', 'in', ids)
      .where('ord', '=', 0)
      .execute(),
    context.mode === 'hidden' ? popularityOf(db, ids) : Promise.resolve(new Map()),
  ]);
  const playable = await playabilities(db, deps.catalogAccess, principal, [...sources.values()]);
  const artistOf = new Map(mainArtists.map((a) => [a.recording_id, a.artist_id]));
  const hiddenArtists = await deps.excludedEntities(db, [...new Set(artistOf.values())]);
  const ceiling = POPULARITY_CEILING.below_top_50;

  const perArtist = new Map<string, number>();
  const picked: string[] = [];
  for (const c of candidates) {
    if (picked.length === opts.size) break;
    const id = c.recording_id;
    if (excluded.has(id)) continue;
    const src = sources.get(id);
    if (!src || playable.get(src)?.playable !== true) continue;
    // Unknown popularity passes, as everywhere in DIG.
    const pct = (popularity.get(id) as { percentile: number | null } | undefined)?.percentile;
    if (context.mode === 'hidden' && pct !== null && pct !== undefined && pct > ceiling) continue;
    const a = artistOf.get(id);
    if (a) {
      if (hiddenArtists.has(a)) continue;
      const n = perArtist.get(a) ?? 0;
      if (n >= PER_ARTIST) continue;
      perArtist.set(a, n + 1);
    }
    picked.push(id);
  }

  // The cutoff is checked again on the final picks: a leak is dropped and counted.
  const out = await recordingsOutBy(db, picked, cutoff);
  const leaks = picked.filter((id) => !out.has(id));
  if (leaks.length > 0) metrics.timeMachineCutoffViolations.inc(leaks.length);
  const safe = picked.filter((id) => out.has(id));
  metrics.timeMachineCandidates.inc({
    mode: context.mode,
    outcome: safe.length === 0 ? 'empty' : safe.length < opts.size ? 'short' : 'filled',
  });
  if (safe.length === 0) return [];

  const [firsts, names] = await Promise.all([
    earliestReleases(ctx, safe),
    entitySummaries(
      db,
      safe.flatMap((id) => {
        const a = artistOf.get(id);
        return a ? [a] : [];
      }),
    ),
  ]);
  return safe.flatMap((id) => {
    const f = firsts.get(id);
    if (!f) return [];
    const a = artistOf.get(id);
    return [
      {
        recording_id: id,
        reason: {
          code: 'time_machine' as const,
          name: (a && names.get(a)?.name) ?? null,
          basis: 'declared' as const,
          release_date: f.release_date,
          date_precision: f.date_precision,
          cutoff,
        },
      },
    ];
  });
}

/** Each recording's earliest dated release (by last possible day, then id). */
async function earliestReleases(ctx: AppContext, recordingIds: string[]) {
  const rows = await sql<{
    recording_id: string;
    release_date: string;
    date_precision: ReleaseDatePrecision;
  }>`
    SELECT DISTINCT ON (rt.recording_id)
      rt.recording_id, r.release_date::text AS release_date, r.release_date_precision AS date_precision
    FROM release_track rt JOIN release r ON r.id = rt.release_id
    WHERE rt.recording_id IN (${sql.join(recordingIds)}) AND r.release_date_latest IS NOT NULL
    ORDER BY rt.recording_id, r.release_date_latest, r.id`.execute(ctx.db);
  return new Map(rows.rows.map((r) => [r.recording_id, r]));
}

/**
 * What a cutoff leaves to listen to (setup screen): releases out by then, releases
 * left out because their date is too coarse to tell, undated ones, and how many of
 * those out have a track the listener can play now. Playability is the listener's
 * own licence country and plan (EXP-027); nothing here takes a region.
 */
export async function timeMachineCoverage(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  cutoff: string,
) {
  const db = ctx.db;
  const counts = await sql<{ out: number; uncertain: number; undated: number }>`
    SELECT
      count(*) FILTER (WHERE release_date_latest <= ${cutoff}::date)::int AS out,
      count(*) FILTER (WHERE release_date <= ${cutoff}::date
        AND release_date_latest > ${cutoff}::date)::int AS uncertain,
      count(*) FILTER (WHERE release_date_latest IS NULL)::int AS undated
    FROM release`.execute(db);
  const c = counts.rows[0] ?? { out: 0, uncertain: 0, undated: 0 };

  // Playable releases among a bounded sample of those out (newest first).
  const SAMPLE = 500;
  const outIds = (
    await db
      .selectFrom('release')
      .select('id')
      .where('release_date_latest', '<=', cutoff)
      .orderBy('release_date_latest', 'desc')
      .orderBy('id')
      .limit(SAMPLE)
      .execute()
  ).map((r) => r.id);
  let playableReleases = 0;
  if (outIds.length > 0) {
    const excluded = await deps.excludedEntities(db, outIds);
    const visible = outIds.filter((id) => !excluded.has(id));
    const tracks = visible.length
      ? await db
          .selectFrom('release_track')
          .select(['release_id', 'recording_id'])
          .where('release_id', 'in', visible)
          .execute()
      : [];
    const sources = await recordingSources(
      db,
      tracks.map((t) => t.recording_id),
    );
    const playable = await playabilities(db, deps.catalogAccess, principal, [...sources.values()]);
    const ok = new Set<string>();
    for (const t of tracks) {
      const src = sources.get(t.recording_id);
      if (src && playable.get(src)?.playable === true) ok.add(t.release_id);
    }
    playableReleases = ok.size;
  }
  return {
    cutoff,
    releases_out: c.out,
    releases_uncertain: c.uncertain,
    releases_undated: c.undated,
    playable_releases: playableReleases,
    /** True when the playable count looked only at the newest releases out. */
    playable_sampled: c.out > SAMPLE,
  };
}

/** Releases that came out after `previous` and by `next` (shown after "다음 달로"). */
export async function releasesBetween(ctx: AppContext, previous: string, next: string) {
  const r = await ctx.db
    .selectFrom('release')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('release_date_latest', '>', previous)
    .where('release_date_latest', '<=', next)
    .executeTakeFirstOrThrow();
  return r.n;
}
