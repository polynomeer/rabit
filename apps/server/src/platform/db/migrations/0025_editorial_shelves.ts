import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Editorial shelves on Home (ADR-0029): operator-curated releases, targeted by
 * territory and time window, shown to listeners only where the releases are available.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE editorial_shelf (
      id text PRIMARY KEY,
      title text NOT NULL,
      description text,
      position integer NOT NULL DEFAULT 0,
      territories text[] NOT NULL DEFAULT '{}',
      starts_at timestamptz,
      ends_at timestamptz,
      published boolean NOT NULL DEFAULT false,
      updated_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
    );
    CREATE TABLE editorial_shelf_item (
      shelf_id text NOT NULL REFERENCES editorial_shelf (id) ON DELETE CASCADE,
      position integer NOT NULL,
      release_id text NOT NULL REFERENCES release (id),
      note text,
      PRIMARY KEY (shelf_id, release_id)
    );
    CREATE INDEX editorial_shelf_live ON editorial_shelf (position) WHERE published;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE editorial_shelf_item; DROP TABLE editorial_shelf`.execute(db);
}
