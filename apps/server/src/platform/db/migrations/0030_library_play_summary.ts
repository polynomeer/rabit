import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Last-played summary for rediscovery (ADR-0035): one row per user and saved
 * recording with the last qualified play and a count, kept beyond the 90-day
 * listening-event purge. No per-play rows, client times or locations. Rows go when
 * the recording is no longer saved and with the account.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE library_play_summary (
      user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      recording_id text NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      last_qualified_at timestamptz NOT NULL,
      qualified_plays integer NOT NULL CHECK (qualified_plays > 0),
      PRIMARY KEY (user_id, recording_id)
    );
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE library_play_summary`.execute(db);
}
