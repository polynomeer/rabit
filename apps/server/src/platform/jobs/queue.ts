import { sql } from 'kysely';
import type { DbOrTx } from '../db/db.js';
import { newId } from '../ids.js';

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  /** Unique key: a second enqueue with the same key is a no-op (idempotent producers). */
  dedupeKey: string;
  runAfter?: Date;
  maxAttempts?: number;
  correlationId?: string | null;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

/** Enqueue inside the caller's transaction so state change and job commit together. */
export async function enqueue(db: DbOrTx, input: EnqueueInput): Promise<boolean> {
  const res = await db
    .insertInto('job')
    .values({
      id: newId('job'),
      kind: input.kind,
      payload: JSON.stringify(input.payload),
      dedupe_key: input.dedupeKey,
      max_attempts: input.maxAttempts ?? 5,
      // Due times use the database clock, the same clock claims compare against: an
      // app host whose clock runs ahead would otherwise delay its own jobs.
      run_after: input.runAfter ?? sql<Date>`now()`,
      correlation_id: input.correlationId ?? null,
      locked_by: null,
      locked_until: null,
      last_error: null,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .executeTakeFirst();
  return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
}

/** Claims up to `limit` ready jobs with a lease (`FOR UPDATE SKIP LOCKED`). */
export async function claimJobs(
  db: DbOrTx,
  opts: { workerId: string; kinds: string[]; limit: number; leaseMs: number },
): Promise<ClaimedJob[]> {
  if (opts.kinds.length === 0 || opts.limit <= 0) return [];
  const rows = await sql<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string | null;
  }>`
    UPDATE job SET
      status = 'running',
      attempts = attempts + 1,
      locked_by = ${opts.workerId},
      locked_until = now() + make_interval(secs => ${opts.leaseMs / 1000}),
      updated_at = now()
    WHERE id IN (
      SELECT id FROM job
      WHERE status = 'queued' AND run_after <= now() AND kind = ANY(${opts.kinds})
      ORDER BY run_after
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts, correlation_id`.execute(db);
  return rows.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    correlationId: r.correlation_id,
  }));
}

export async function completeJob(db: DbOrTx, id: string, workerId: string): Promise<void> {
  await db
    .updateTable('job')
    .set({ status: 'succeeded', locked_by: null, locked_until: null, updated_at: new Date() })
    .where('id', '=', id)
    .where('locked_by', '=', workerId)
    .execute();
}

/** Exponential backoff with full jitter: base * 2^(attempt-1), capped. */
export function backoffMs(attempt: number, baseMs = 5_000, capMs = 15 * 60_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export async function failJob(
  db: DbOrTx,
  job: Pick<ClaimedJob, 'id' | 'attempts' | 'maxAttempts'>,
  workerId: string,
  error: string,
  opts: { permanent: boolean },
): Promise<'retry' | 'dead'> {
  const dead = opts.permanent || job.attempts >= job.maxAttempts;
  await db
    .updateTable('job')
    .set({
      status: dead ? 'dead' : 'queued',
      run_after: dead
        ? sql<Date>`now()`
        : sql<Date>`now() + make_interval(secs => ${backoffMs(job.attempts) / 1000})`,
      last_error: error.slice(0, 2000),
      locked_by: null,
      locked_until: null,
      updated_at: new Date(),
    })
    .where('id', '=', job.id)
    .where('locked_by', '=', workerId)
    .execute();
  return dead ? 'dead' : 'retry';
}

/**
 * Recovers jobs whose worker died while holding the lease. A crash counts as an
 * attempt: jobs that already used all attempts go to the DLQ instead of being
 * requeued forever (a poison pill that kills workers must not loop, review #3).
 * Returns the jobs that became dead so their `onDead` compensation can run.
 */
export async function reclaimExpiredLeases(
  db: DbOrTx,
): Promise<{ requeued: number; dead: ClaimedJob[] }> {
  const rows = await sql<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string | null;
    status: string;
  }>`
    UPDATE job SET
      status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
      run_after = now() + make_interval(secs => LEAST(900, 5 * power(2, GREATEST(attempts - 1, 0)))),
      last_error = 'lease expired (worker crashed or timed out)',
      locked_by = NULL,
      locked_until = NULL,
      updated_at = now()
    WHERE status = 'running' AND locked_until < now()
    RETURNING id, kind, payload, attempts, max_attempts, correlation_id, status`.execute(db);
  const dead = rows.rows
    .filter((r) => r.status === 'dead')
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      correlationId: r.correlation_id,
    }));
  return { requeued: rows.rows.length - dead.length, dead };
}

/** Operator retry of a dead/failed job (ops API). */
export async function requeueJob(db: DbOrTx, id: string): Promise<boolean> {
  const res = await db
    .updateTable('job')
    .set({
      status: 'queued',
      attempts: 0,
      run_after: sql<Date>`now()`,
      last_error: null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('status', 'in', ['dead', 'failed'])
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/**
 * How long a claim lasts without a heartbeat. Workers extend the leases of jobs
 * they are still running, so a crashed worker's jobs return to the queue after
 * this window, whatever their kind's maximum runtime.
 */
export const LEASE_WINDOW_MS = 120_000;

/** Heartbeat: extends this worker's leases; returns the ids it still holds. */
export async function extendLeases(
  db: DbOrTx,
  workerId: string,
  ids: readonly string[],
  windowMs = LEASE_WINDOW_MS,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .updateTable('job')
    .set({
      locked_until: sql<Date>`now() + make_interval(secs => ${windowMs / 1000})`,
      updated_at: new Date(),
    })
    .where('id', 'in', [...ids])
    .where('locked_by', '=', workerId)
    .where('status', '=', 'running')
    .returning('id')
    .execute();
  return new Set(rows.map((r) => r.id));
}

/**
 * Hands jobs back on shutdown: queued again at once, and the interrupted attempt
 * does not count (a deploy is not the job's fault).
 */
export async function releaseJobs(
  db: DbOrTx,
  workerId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db
    .updateTable('job')
    .set((eb) => ({
      status: 'queued',
      attempts: sql<number>`GREATEST(${eb.ref('attempts')} - 1, 0)`,
      run_after: sql<Date>`now()`,
      locked_by: null,
      locked_until: null,
      last_error: 'released on shutdown',
      updated_at: new Date(),
    }))
    .where('id', 'in', [...ids])
    .where('locked_by', '=', workerId)
    .where('status', '=', 'running')
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** Deletes matching rows in batches, so no single statement holds locks or the vacuum horizon for long. */
export async function deleteInBatches(
  db: DbOrTx,
  table: 'job' | 'outbox_event' | 'listening_event',
  where: ReturnType<typeof sql>,
  batch = 5_000,
  maxBatches = 200,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const r = await sql`
      DELETE FROM ${sql.table(table)} WHERE ctid IN (
        SELECT ctid FROM ${sql.table(table)} WHERE ${where} LIMIT ${batch}
      )`.execute(db);
    const n = Number(r.numAffectedRows ?? 0);
    total += n;
    if (n < batch) break;
  }
  return total;
}
