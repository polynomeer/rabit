import { sql, type RawBuilder } from 'kysely';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import { metrics } from '../../platform/metrics.js';

/**
 * Monthly usage statements for rights holders (ADR-0025, owner decision 2026-10-20).
 *
 * - A **stream** is one catalog playback session whose accepted listening time
 *   reaches 30 s, or half the track when it is shorter than 30 s. A session counts
 *   once however often it was replayed or sought.
 * - A session belongs to the month (Asia/Seoul) in which it was issued, with the
 *   territory and access (subscription, purchase, grant) recorded at that moment.
 * - A month closes once, `CLOSE_AFTER_DAYS` after it ends, into immutable lines per
 *   recording, rights grant, territory and access. Raw listening events are only
 *   purged once their month is closed; deleted accounts leave their qualifying
 *   streams behind as anonymous carry-over rows.
 */
export const USAGE_POLICY = 'usage/v1';
export const USAGE_TIME_ZONE = 'Asia/Seoul';
export const QUALIFYING_MS = 30_000;
/** Late listening events (client batches, the 1-minute tail after a session) land first. */
export const CLOSE_AFTER_DAYS = 3;
/** Months looked at by each run: the raw events of older months are gone. */
const LOOKBACK_MONTHS = 3;

/** Serialises closing and account folding, so no stream is counted twice or lost. */
const lock = sql`SELECT pg_advisory_xact_lock(hashtext('usage_statement'))`;

/** Start of a month (YYYY-MM-01, Seoul) as an instant. */
const monthStart = (month: string): RawBuilder<Date> =>
  sql<Date>`(${month}::date::timestamp AT TIME ZONE ${USAGE_TIME_ZONE})`;
const monthEnd = (month: string): RawBuilder<Date> =>
  sql<Date>`((${month}::date + interval '1 month')::timestamp AT TIME ZONE ${USAGE_TIME_ZONE})`;

/** The Seoul month (YYYY-MM-01) of `at`, shifted by `offset` months. */
export function seoulMonth(at: Date, offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: USAGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value) - 1 + offset;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Qualifying streams of catalog sessions issued in [from, to), optionally of one
 * user: one row per session with its month, keys and accepted listening time.
 */
function qualifyingStreams(from: RawBuilder<Date>, to: RawBuilder<Date>, userId?: string) {
  return sql`
    SELECT
      date_trunc('month', p.issued_at AT TIME ZONE ${USAGE_TIME_ZONE})::date AS month,
      p.user_id, e.recording_id, p.rights_grant_id, p.territory, p.access_origin,
      sum(e.played_ms) AS played
    FROM playback_session p
    JOIN listening_event e ON e.session_id = p.id AND e.accepted AND e.recording_id IS NOT NULL
    JOIN recording r ON r.id = e.recording_id
    WHERE p.rights_grant_id IS NOT NULL AND p.territory IS NOT NULL AND p.access_origin IS NOT NULL
      AND p.issued_at >= ${from} AND p.issued_at < ${to}
      ${userId === undefined ? sql`` : sql`AND p.user_id = ${userId}`}
    GROUP BY p.id, p.issued_at, p.user_id, e.recording_id, p.rights_grant_id, p.territory,
      p.access_origin, r.duration_ms
    HAVING sum(e.played_ms) >= CASE
      WHEN r.duration_ms IS NULL OR r.duration_ms >= ${QUALIFYING_MS} THEN ${QUALIFYING_MS}
      ELSE ceil(r.duration_ms / 2.0) END`;
}

/**
 * Closes one month: lines from live sessions plus carry-over are computed into a
 * transaction-local table, then the statement and its lines are written once.
 */
async function closeMonth(tx: DbOrTx, month: string): Promise<number> {
  await sql`
    CREATE TEMP TABLE usage_closing ON COMMIT DROP AS
    WITH q AS (${qualifyingStreams(monthStart(month), monthEnd(month))}),
    live AS (
      SELECT recording_id, rights_grant_id, territory, access_origin,
        count(*) AS streams, count(DISTINCT user_id) AS listeners, sum(played) AS played_ms
      FROM q GROUP BY 1, 2, 3, 4
    ),
    carry AS (
      SELECT recording_id, rights_grant_id, territory, access_origin,
        sum(streams) AS streams, count(*) AS listeners, sum(played_ms) AS played_ms
      FROM usage_carryover WHERE month = ${month}::date GROUP BY 1, 2, 3, 4
    )
    SELECT u.recording_id, r.isrc, u.rights_grant_id, g.rights_holder, g.contract_ref,
      u.territory, u.access_origin, sum(u.streams) AS streams, sum(u.listeners) AS listeners,
      sum(u.played_ms) AS played_ms
    FROM (SELECT * FROM live UNION ALL SELECT * FROM carry) u
    JOIN recording r ON r.id = u.recording_id
    JOIN rights_grant g ON g.id = u.rights_grant_id
    GROUP BY 1, 2, 3, 4, 5, 6, 7`.execute(tx);
  const totals = await sql<{ streams: number; lines: number }>`
    SELECT COALESCE(sum(streams), 0) AS streams, count(*) AS lines FROM usage_closing`.execute(tx);
  const t = totals.rows[0] ?? { streams: 0, lines: 0 };
  await sql`
    INSERT INTO usage_statement (month, policy, streams, line_count)
    VALUES (${month}::date, ${USAGE_POLICY}, ${t.streams}, ${t.lines})`.execute(tx);
  await sql`
    INSERT INTO usage_statement_line (month, recording_id, isrc, rights_grant_id, rights_holder,
      contract_ref, territory, access_origin, streams, listeners, played_ms)
    SELECT ${month}::date, recording_id, isrc, rights_grant_id, rights_holder, contract_ref,
      territory, access_origin, streams, listeners, played_ms
    FROM usage_closing`.execute(tx);
  await sql`DELETE FROM usage_carryover WHERE month = ${month}::date`.execute(tx);
  return t.streams;
}

/**
 * Closes every month of the lookback window that ended at least CLOSE_AFTER_DAYS
 * ago and is not closed yet, oldest first. Idempotent; returns the months closed.
 */
export async function closeUsageStatements(db: Db, now = new Date()): Promise<string[]> {
  const closed: string[] = [];
  for (let back = LOOKBACK_MONTHS; back >= 1; back--) {
    const month = seoulMonth(now, -back);
    const done = await db.transaction().execute(async (tx) => {
      await lock.execute(tx);
      const ready = await sql<{ ready: boolean; exists: boolean }>`
        SELECT ${monthEnd(month)} + make_interval(days => ${CLOSE_AFTER_DAYS}) <= ${now} AS ready,
          EXISTS (SELECT 1 FROM usage_statement WHERE month = ${month}::date) AS exists`.execute(
        tx,
      );
      const r = ready.rows[0];
      if (!r?.ready || r.exists) return false;
      const streams = await closeMonth(tx, month);
      metrics.usageStreams.inc(streams);
      return true;
    });
    if (done) closed.push(month);
  }
  return closed;
}

/**
 * Account deletion: the account's qualifying streams of months not yet closed stay
 * reportable as anonymous carry-over rows (one per key and month, so `listeners`
 * still counts this account once); the caller then deletes the listening events.
 */
export async function foldAccountUsage(db: Db, userId: string): Promise<number> {
  return db.transaction().execute(async (tx) => {
    await lock.execute(tx);
    const res = await sql`
      WITH q AS (${qualifyingStreams(sql<Date>`'-infinity'::timestamptz`, sql<Date>`'infinity'::timestamptz`, userId)})
      INSERT INTO usage_carryover (month, recording_id, rights_grant_id, territory, access_origin,
        streams, played_ms)
      SELECT month, recording_id, rights_grant_id, territory, access_origin, count(*), sum(played)
      FROM q
      WHERE NOT EXISTS (SELECT 1 FROM usage_statement s WHERE s.month = q.month)
      GROUP BY 1, 2, 3, 4, 5`.execute(tx);
    return Number(res.numAffectedRows ?? 0);
  });
}

/**
 * End of the latest closed month: raw listening events received before it belong
 * to closed months only and may be purged. Null while nothing is closed.
 */
export async function closedThrough(db: DbOrTx): Promise<Date | null> {
  const r = await sql<{ at: Date | null }>`
    SELECT (max(month) + interval '1 month')::timestamp AT TIME ZONE ${USAGE_TIME_ZONE} AS at
    FROM usage_statement`.execute(db);
  return r.rows[0]?.at ?? null;
}

export async function listUsageStatements(db: DbOrTx) {
  const rows = await db
    .selectFrom('usage_statement')
    .selectAll()
    .orderBy('month', 'desc')
    .limit(60)
    .execute();
  return rows.map((r) => ({
    month: r.month.slice(0, 7),
    policy: r.policy,
    streams: r.streams,
    line_count: r.line_count,
    closed_at: r.closed_at.toISOString(),
  }));
}

export async function usageStatementLines(db: DbOrTx, month: string) {
  return db
    .selectFrom('usage_statement_line')
    .select([
      'recording_id',
      'isrc',
      'rights_grant_id',
      'rights_holder',
      'contract_ref',
      'territory',
      'access_origin',
      'streams',
      'listeners',
      'played_ms',
    ])
    .where('month', '=', `${month}-01`)
    .orderBy('rights_holder')
    .orderBy('isrc')
    .orderBy('recording_id')
    .orderBy('territory')
    .orderBy('access_origin')
    .execute();
}

const CSV_COLUMNS = [
  'month',
  'isrc',
  'recording_id',
  'rights_holder',
  'contract_ref',
  'rights_grant_id',
  'territory',
  'access',
  'streams',
  'listeners',
  'played_ms',
] as const;

/** RFC 4180 field: quoted when it holds a comma, quote or line break. */
function csvField(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function usageCsv(
  month: string,
  lines: Awaited<ReturnType<typeof usageStatementLines>>,
): string {
  const rows = lines.map((l) =>
    [
      month,
      l.isrc,
      l.recording_id,
      l.rights_holder,
      l.contract_ref,
      l.rights_grant_id,
      l.territory,
      l.access_origin,
      l.streams,
      l.listeners,
      l.played_ms,
    ]
      .map(csvField)
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
