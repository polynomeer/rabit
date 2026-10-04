import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Audio Log metadata (LOG-001..005). An Audio Log is an AudioObject of kind
 * `audio_log`; this table only adds user metadata. `linked_recording_id` gets its
 * FK with the catalog tables (0006).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE audio_log (
      id text PRIMARY KEY CHECK (id ~ '^alg_[0-9A-HJKMNP-TV-Z]{26}$'),
      audio_source_id text NOT NULL UNIQUE REFERENCES audio_source(id) ON DELETE CASCADE,
      author_user_id text NOT NULL REFERENCES app_user(id),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      note text CHECK (note IS NULL OR char_length(note) <= 5000),
      recorded_at timestamptz NOT NULL,
      recorded_tz text NOT NULL,
      linked_recording_id text,
      tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX audio_log_author_idx ON audio_log (author_user_id, recorded_at DESC, id)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS audio_log`.execute(db);
}
