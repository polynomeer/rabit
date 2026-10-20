import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Playback quality reports (QoE, slo.md): a client reports each session once; the
 * values go to metrics only. The timestamp makes a repeated report a no-op.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE playback_session ADD COLUMN quality_reported_at timestamptz`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE playback_session DROP COLUMN quality_reported_at`.execute(db);
}
