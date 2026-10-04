import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/** Queue snapshot for metrics and readiness (ADR-0005). */
export async function queueHealth(db: Db) {
  const rows = await db
    .selectFrom('job')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('status')
    .execute();
  const oldest = await db
    .selectFrom('job')
    .select(sql<number>`COALESCE(EXTRACT(EPOCH FROM now() - min(run_after)), 0)`.as('age'))
    .where('status', '=', 'queued')
    .where('run_after', '<=', new Date())
    .executeTakeFirst();
  const outbox = await db
    .selectFrom('outbox_event')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('dispatched_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    oldestQueuedSeconds: Math.max(0, Math.round(oldest?.age ?? 0)),
    outboxPending: outbox.n,
  };
}
