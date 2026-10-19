import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Index for the retention delete of dispatched outbox events (ops.housekeeping),
 * found by age without scanning the pending rows. Finished jobs already use
 * job_status_idx (status, updated_at).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE INDEX outbox_dispatched_idx ON outbox_event (dispatched_at) WHERE dispatched_at IS NOT NULL;`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP INDEX outbox_dispatched_idx').execute(db);
}
