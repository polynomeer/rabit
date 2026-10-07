import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Blind Digging (DIG-010): a round of recordings heard without their artist,
 * release, year or popularity; each is revealed after Keep or Pass. Private to
 * the user, deleted with the account, exported with the DIG history.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE blind_dig (
      id text PRIMARY KEY CHECK (id ~ '^bld_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      start_entity_id text REFERENCES music_entity(id) ON DELETE SET NULL,
      popularity text NOT NULL CHECK (popularity IN ('any', 'below_top_50', 'deep_cuts', 'obscure')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX blind_dig_user_idx ON blind_dig (user_id, created_at DESC);
    CREATE TABLE blind_dig_item (
      id text PRIMARY KEY CHECK (id ~ '^bli_[0-9A-HJKMNP-TV-Z]{26}$'),
      blind_dig_id text NOT NULL REFERENCES blind_dig(id) ON DELETE CASCADE,
      recording_id text NOT NULL REFERENCES recording(id),
      position integer NOT NULL CHECK (position >= 0),
      decision text CHECK (decision IN ('keep', 'pass')),
      decided_at timestamptz,
      CHECK ((decision IS NULL) = (decided_at IS NULL)),
      UNIQUE (blind_dig_id, position),
      UNIQUE (blind_dig_id, recording_id)
    );`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE blind_dig_item; DROP TABLE blind_dig').execute(db);
}
