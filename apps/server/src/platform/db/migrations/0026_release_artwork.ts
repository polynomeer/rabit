import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Release artwork (ADR-0031): the delivered original, its processing state and the
 * version its derived sizes are stored under. A new cover is a new version, so old
 * URLs stop working while caches can keep a version forever.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE release_artwork (
      release_id text PRIMARY KEY REFERENCES release (id),
      original_key text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      status text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
      width integer,
      height integer,
      failure text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE release_artwork`.execute(db);
}
