import { sql } from 'kysely';
import type { Db } from '../../platform/db/db.js';
import type { PopularityTier } from '../../platform/db/schema.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { metrics } from '../../platform/metrics.js';

export interface ListeningEventInput {
  event_id: string;
  session_id: string;
  sequence: number;
  type: 'started' | 'heartbeat' | 'seek' | 'paused' | 'ended';
  position_ms: number;
  played_ms: number;
  client_time: string;
}

/** Slack added to wall-clock checks for network jitter and client buffering. */
const PLAYED_TOLERANCE_MS = 5_000;
/** Events may arrive shortly after a session ends (final `ended`/`paused` flush). */
const SESSION_GRACE_MS = 60_000;

/**
 * Stores listening events (PLY-015, T19). Acceptance is decided by the server
 * per session under a row lock on `playback_session`:
 * - the session must belong to the caller and be active (or have expired less
 *   than a minute ago); revoked sessions accept nothing;
 * - positions must fit the audio;
 * - the **total** accepted `played_ms` of the session can never exceed the wall
 *   clock time since the session was issued (+ tolerance), across events, batches
 *   and concurrent requests (review #2).
 * Duplicates (same session + event id) are ignored; out-of-order events are
 * accepted by sequence. Client-side counts are never trusted alone.
 */
export async function recordListeningEvents(
  db: Db,
  principal: Principal,
  events: ListeningEventInput[],
) {
  let accepted = 0;
  let duplicates = 0;
  const rejected: { event_id: string; reason: string }[] = [];
  const reject = (event_id: string, reason: string) => {
    rejected.push({ event_id, reason });
    metrics.listeningEvents.inc({ outcome: 'rejected' });
  };
  const bySession = new Map<string, ListeningEventInput[]>();
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), e]);
  }

  for (const [sessionId, list] of bySession) {
    await db.transaction().execute(async (tx) => {
      const s = await tx
        .selectFrom('playback_session as p')
        .innerJoin('audio_source as src', 'src.id', 'p.audio_source_id')
        .innerJoin('audio_version as v', 'v.id', 'src.audio_version_id')
        .select([
          'p.id',
          'p.user_id',
          'p.status',
          'p.issued_at',
          'p.expires_at',
          'v.duration_ms',
          'v.recording_id',
          'src.origin',
        ])
        .where('p.id', '=', sessionId)
        .forUpdate(['p'])
        .executeTakeFirst();
      if (!s || s.user_id !== principal.userId) {
        // Never store events against another user's session.
        for (const e of list) reject(e.event_id, 'not_owner');
        return;
      }
      const now = Date.now();
      const active = s.status !== 'revoked' && s.expires_at.getTime() + SESSION_GRACE_MS > now;
      const used = await tx
        .selectFrom('listening_event')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('played_ms'), eb.val(0)).as('ms'))
        .where('session_id', '=', s.id)
        .where('accepted', '=', true)
        .executeTakeFirstOrThrow();
      let budget = now - s.issued_at.getTime() + PLAYED_TOLERANCE_MS - used.ms;

      for (const e of list) {
        let reason: string | null = null;
        if (!active) reason = 'session_inactive';
        else if (s.duration_ms !== null && e.position_ms > s.duration_ms + PLAYED_TOLERANCE_MS)
          reason = 'position_out_of_range';
        else if (e.played_ms > budget) reason = 'played_exceeds_wall_clock';
        const res = await tx
          .insertInto('listening_event')
          .values({
            id: newId('listeningEvent'),
            session_id: s.id,
            user_id: principal.userId,
            recording_id: s.origin === 'catalog' ? s.recording_id : null,
            client_event_id: e.event_id,
            sequence: e.sequence,
            type: e.type,
            position_ms: e.position_ms,
            played_ms: e.played_ms,
            client_time: e.client_time,
            accepted: reason === null,
            reject_reason: reason,
          })
          .onConflict((oc) => oc.columns(['session_id', 'client_event_id']).doNothing())
          .executeTakeFirst();
        if (Number(res.numInsertedOrUpdatedRows ?? 0) === 0) {
          duplicates++;
          metrics.listeningEvents.inc({ outcome: 'duplicate' });
        } else if (reason) {
          reject(e.event_id, reason);
        } else {
          accepted++;
          budget -= e.played_ms;
          metrics.listeningEvents.inc({ outcome: 'accepted' });
        }
      }
    });
  }
  return { accepted, duplicates, rejected };
}

export const POPULARITY_POLICY = 'popularity/v1';
export const POPULARITY_WINDOW_DAYS = 90;

export function tierFor(percentile: number | null): PopularityTier {
  if (percentile === null) return 'unknown';
  if (percentile >= 0.9) return 'top';
  if (percentile >= 0.5) return 'upper';
  if (percentile >= 0.1) return 'deep_cut';
  return 'obscure';
}

/**
 * Recomputes relative popularity for catalog recordings (DIG-007, dig spec §4).
 * A listener counts for a recording when their accepted played time in the window
 * reaches 30 s or half of the duration. The percentile is the share of catalog
 * recordings with strictly fewer listeners — relative, independent of absolute
 * counts. With no qualifying listens at all, every tier is `unknown`.
 */
export async function computePopularity(db: Db): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const rows = await sql<{ recording_id: string; listeners: number; plays: number }>`
      WITH per_user AS (
        SELECT e.recording_id, e.user_id, sum(e.played_ms) AS played,
               count(*) FILTER (WHERE e.type = 'started') AS starts
        FROM listening_event e
        WHERE e.accepted AND e.recording_id IS NOT NULL
          AND e.received_at > now() - make_interval(days => ${POPULARITY_WINDOW_DAYS})
        GROUP BY e.recording_id, e.user_id
      )
      SELECT r.id AS recording_id,
             count(pu.user_id) FILTER (
               WHERE pu.played >= LEAST(30000, COALESCE(r.duration_ms, 60000) / 2)
             )::int AS listeners,
             COALESCE(sum(pu.starts), 0)::int AS plays
      FROM recording r
      LEFT JOIN per_user pu ON pu.recording_id = r.id
      WHERE r.catalog_audio_source_id IS NOT NULL
      GROUP BY r.id`.execute(tx);
    const list = rows.rows;
    const anyData = list.some((r) => r.listeners > 0);
    const sorted = list.map((r) => r.listeners).sort((a, b) => a - b);
    const fewer = (n: number) => {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((sorted[mid] ?? 0) < n) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (const r of list) {
      const percentile =
        anyData && list.length > 0
          ? Math.round((fewer(r.listeners) / list.length) * 10000) / 10000
          : null;
      await tx
        .insertInto('recording_popularity')
        .values({
          recording_id: r.recording_id,
          window_days: POPULARITY_WINDOW_DAYS,
          distinct_listeners: r.listeners,
          plays: r.plays,
          percentile,
          tier: tierFor(percentile),
          policy_version: POPULARITY_POLICY,
        })
        .onConflict((oc) =>
          oc.column('recording_id').doUpdateSet({
            window_days: POPULARITY_WINDOW_DAYS,
            distinct_listeners: r.listeners,
            plays: r.plays,
            percentile,
            tier: tierFor(percentile),
            policy_version: POPULARITY_POLICY,
            computed_at: new Date(),
          }),
        )
        .execute();
    }
    return list.length;
  });
}

/** Raw events older than the retention window are purged (NFR-PRV-005 proposal). */
export async function purgeListeningEvents(db: Db): Promise<number> {
  const res = await db
    .deleteFrom('listening_event')
    .where('received_at', '<', new Date(Date.now() - POPULARITY_WINDOW_DAYS * 86_400_000))
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}
