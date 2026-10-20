import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/**
 * Queue snapshot for metrics and readiness (ADR-0005). `kinds` lists the job kinds
 * the workers handle; each reports the age of its oldest ready job (0 when none),
 * so alerts can tell a catalog backlog from stalled revocations.
 */
export async function queueHealth(db: Db, kinds: readonly string[] = []) {
  const rows = await db
    .selectFrom('job')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('status')
    .execute();
  const ready = await db
    .selectFrom('job')
    .select([
      'kind',
      (eb) => eb.fn.countAll<number>().as('n'),
      sql<number>`EXTRACT(EPOCH FROM now() - min(run_after))`.as('age'),
    ])
    .where('status', '=', 'queued')
    .where('run_after', '<=', new Date())
    .groupBy('kind')
    .execute();
  const outbox = await db
    .selectFrom('outbox_event')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('dispatched_at', 'is', null)
    .executeTakeFirstOrThrow();
  const byKind: Record<string, { ready: number; oldestSeconds: number }> = {};
  for (const k of kinds) byKind[k] = { ready: 0, oldestSeconds: 0 };
  for (const r of ready) {
    byKind[r.kind] = { ready: r.n, oldestSeconds: Math.max(0, Math.round(r.age)) };
  }
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    byKind,
    outboxPending: outbox.n,
  };
}

export type QueueHealth = Awaited<ReturnType<typeof queueHealth>>;
