import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { ReleaseDatePrecision } from '../../platform/db/schema.js';
import type { Principal } from '../../platform/http/principal.js';
import { entitySummaries } from '../catalog/index.js';

/**
 * Rediscover (EX-06, ADR-0035): saved recordings not played for a while, from a
 * last-played summary that outlives the 90-day listening-event purge. Only Rabit's
 * own saves and qualified plays are used; there is one row per saved recording and
 * nothing per play. Without a row the answer is "no history", never "not played".
 */

/** PlayQualified: counts the play when the recording is saved; anything else is ignored. */
export async function recordQualifiedPlay(
  db: DbOrTx,
  play: { user_id: string; recording_id: string; at: string },
): Promise<void> {
  await sql`
    INSERT INTO library_play_summary (user_id, recording_id, last_qualified_at, qualified_plays)
    SELECT ${play.user_id}, ${play.recording_id}, ${play.at}::timestamptz, 1
    WHERE EXISTS (
      SELECT 1 FROM library_item
      WHERE user_id = ${play.user_id} AND ref_type = 'recording' AND ref_id = ${play.recording_id}
    )
    ON CONFLICT (user_id, recording_id) DO UPDATE SET
      last_qualified_at = greatest(library_play_summary.last_qualified_at, excluded.last_qualified_at),
      qualified_plays = library_play_summary.qualified_plays + 1`.execute(db);
}

/** The summary goes with the save (ADR-0035): rows of recordings no longer saved are removed. */
export async function pruneSummaries(db: DbOrTx, userId: string): Promise<void> {
  await sql`
    DELETE FROM library_play_summary s
    WHERE s.user_id = ${userId} AND NOT EXISTS (
      SELECT 1 FROM library_item i
      WHERE i.user_id = s.user_id AND i.ref_type = 'recording' AND i.ref_id = s.recording_id
    )`.execute(db);
}

export async function clearSummaries(db: DbOrTx, userId: string): Promise<number> {
  const r = await db
    .deleteFrom('library_play_summary')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}

const MAX_ITEMS = 200;

export async function rediscover(
  ctx: AppContext,
  principal: Principal,
  q: { inactive_days: number; limit: number },
) {
  const db = ctx.db;
  const since = new Date(Date.now() - q.inactive_days * 86_400_000);
  const rows = await db
    .selectFrom('library_item as i')
    .leftJoin('library_play_summary as s', (j) =>
      j.onRef('s.user_id', '=', 'i.user_id').onRef('s.recording_id', '=', 'i.ref_id'),
    )
    .select([
      'i.id',
      'i.ref_id',
      'i.saved_at',
      'i.note',
      's.last_qualified_at',
      's.qualified_plays',
    ])
    .where('i.user_id', '=', principal.userId)
    .where('i.ref_type', '=', 'recording')
    .where((eb) =>
      eb.or([
        eb('s.last_qualified_at', '<', since),
        eb.and([eb('s.last_qualified_at', 'is', null), eb('i.saved_at', '<', since)]),
      ]),
    )
    // Longest quiet first: the last play, or the save when there is no history.
    .orderBy(sql`coalesce(s.last_qualified_at, i.saved_at)`)
    .orderBy('i.id')
    .limit(Math.min(q.limit, MAX_ITEMS))
    .execute();
  const ids = rows.map((r) => r.ref_id);
  const [summaries, firsts] = await Promise.all([
    entitySummaries(db, ids),
    ids.length
      ? sql<{ recording_id: string; release_date: string; date_precision: ReleaseDatePrecision }>`
          SELECT DISTINCT ON (rt.recording_id)
            rt.recording_id, r.release_date::text AS release_date,
            r.release_date_precision AS date_precision
          FROM release_track rt JOIN release r ON r.id = rt.release_id
          WHERE rt.recording_id IN (${sql.join(ids)}) AND r.release_date_latest IS NOT NULL
          ORDER BY rt.recording_id, r.release_date_latest, r.id`
          .execute(db)
          .then((r) => new Map(r.rows.map((x) => [x.recording_id, x])))
      : Promise.resolve(
          new Map<
            string,
            { release_date: string; date_precision: ReleaseDatePrecision }
          >(),
        ),
  ]);
  return {
    inactive_days: q.inactive_days,
    items: rows.flatMap((r) => {
      const recording = summaries.get(r.ref_id);
      if (!recording) return [];
      const first = firsts.get(r.ref_id);
      return [
        {
          library_item_id: r.id,
          recording,
          saved_at: r.saved_at.toISOString(),
          note: r.note,
          /** `played`: the last qualified play is known; `none`: no play recorded since saving. */
          history: r.last_qualified_at ? ('played' as const) : ('none' as const),
          last_qualified_at: r.last_qualified_at?.toISOString() ?? null,
          qualified_plays: r.qualified_plays ?? 0,
          release_date: first?.release_date ?? null,
          date_precision: first?.date_precision ?? null,
        },
      ];
    }),
  };
}
