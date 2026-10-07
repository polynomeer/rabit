import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Physical Collection, manual registration (COL-001/002/007, P1). A record that
 * the user owns a CD, LP or cassette: `self_declared` until evidence is reviewed.
 * It is a record of ownership, not proof of copyright and never an entitlement
 * (COL-003): no foreign key or trigger connects it to entitlement data.
 * The release link is the user's own choice of edition, not an identification.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE physical_item (
      id text PRIMARY KEY CHECK (id ~ '^phy_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      format text NOT NULL CHECK (format IN ('cd', 'vinyl', 'cassette', 'other')),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
      artist_name text CHECK (length(artist_name) <= 300),
      barcode text CHECK (barcode ~ '^[0-9]{8,14}$'),
      catalog_number text CHECK (length(catalog_number) <= 100),
      release_id text REFERENCES release(id) ON DELETE SET NULL,
      notes text CHECK (length(notes) <= 2000),
      verification_state text NOT NULL DEFAULT 'self_declared'
        CHECK (verification_state IN ('self_declared', 'evidence_reviewed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX physical_item_user_idx ON physical_item (user_id, created_at DESC, id DESC);`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE physical_item`.execute(db);
}
