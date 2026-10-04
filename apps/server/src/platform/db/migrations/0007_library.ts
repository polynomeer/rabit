import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Library, playlists and exports (LIB-001..010). Items reference sources or
 * catalog entities — never file URLs or storage keys (PB Phase 13).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE library_item (
      id text PRIMARY KEY CHECK (id ~ '^lib_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      ref_type text NOT NULL CHECK (ref_type IN ('audio_source','recording','release')),
      ref_id text NOT NULL,
      origin text NOT NULL CHECK (origin IN ('uploaded','logged','saved')),
      note text CHECK (note IS NULL OR char_length(note) <= 1000),
      saved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, ref_type, ref_id)
    )`.execute(db);
  await sql`CREATE INDEX library_item_user_idx ON library_item (user_id, saved_at DESC, id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE playlist (
      id text PRIMARY KEY CHECK (id ~ '^pls_[0-9A-HJKMNP-TV-Z]{26}$'),
      owner_user_id text NOT NULL REFERENCES app_user(id),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      description text CHECK (description IS NULL OR char_length(description) <= 2000),
      visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX playlist_owner_idx ON playlist (owner_user_id, updated_at DESC, id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE playlist_item (
      id text PRIMARY KEY CHECK (id ~ '^pli_[0-9A-HJKMNP-TV-Z]{26}$'),
      playlist_id text NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
      rank integer NOT NULL CHECK (rank >= 0),
      ref_type text NOT NULL CHECK (ref_type IN ('audio_source','recording')),
      ref_id text NOT NULL,
      added_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT playlist_item_rank_unique UNIQUE (playlist_id, rank) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);
  await sql`CREATE INDEX playlist_item_ref_idx ON playlist_item (ref_type, ref_id)`.execute(db);

  await sql`
    CREATE TABLE export_request (
      id text PRIMARY KEY CHECK (id ~ '^exp_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      state text NOT NULL CHECK (state IN ('requested','building','ready','expired','failed')),
      include_originals boolean NOT NULL,
      object_key text,
      bytes bigint,
      expires_at timestamptz,
      failure_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX export_request_user_idx ON export_request (user_id, created_at DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS export_request`.execute(db);
  await sql`DROP TABLE IF EXISTS playlist_item`.execute(db);
  await sql`DROP TABLE IF EXISTS playlist`.execute(db);
  await sql`DROP TABLE IF EXISTS library_item`.execute(db);
}
