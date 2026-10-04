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
      run_after: input.runAfter ?? new Date(),
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
      run_after: dead ? new Date() : new Date(Date.now() + backoffMs(job.attempts)),
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

/** Requeues jobs whose worker died while holding the lease. */
export async function reclaimExpiredLeases(db: DbOrTx): Promise<number> {
  const res = await db
    .updateTable('job')
    .set({ status: 'queued', locked_by: null, locked_until: null, updated_at: new Date() })
    .where('status', '=', 'running')
    .where('locked_until', '<', new Date())
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** Operator retry of a dead/failed job (ops API). */
export async function requeueJob(db: DbOrTx, id: string): Promise<boolean> {
  const res = await db
    .updateTable('job')
    .set({
      status: 'queued',
      attempts: 0,
      run_after: new Date(),
      last_error: null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('status', 'in', ['dead', 'failed'])
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}
