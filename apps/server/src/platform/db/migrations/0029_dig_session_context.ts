import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Exploration context on DIG sessions (EX-05): the cutoff a session digs under, so
 * reopening the session restores it. Validated at the route; NULL = no cutoff.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE dig_session ADD COLUMN context jsonb`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE dig_session DROP COLUMN context`.execute(db);
}
