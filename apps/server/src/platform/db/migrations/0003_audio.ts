import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Universal AudioObject chain (ADR-0014, domain-model §3.2) and upload sessions.
 * `audio_version.recording_id` gets its FK when the catalog tables exist (0005).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE audio_object (
      id text PRIMARY KEY CHECK (id ~ '^aob_[0-9A-HJKMNP-TV-Z]{26}$'),
      kind text NOT NULL CHECK (kind IN ('recording','private_audio','audio_log')),
      current_version_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE audio_version (
      id text PRIMARY KEY CHECK (id ~ '^aov_[0-9A-HJKMNP-TV-Z]{26}$'),
      audio_object_id text NOT NULL REFERENCES audio_object(id) ON DELETE CASCADE,
      version_no integer NOT NULL CHECK (version_no >= 1),
      recording_id text,
      content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
      duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
      technical jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (audio_object_id, version_no)
    )`.execute(db);
  await sql`
    ALTER TABLE audio_object ADD CONSTRAINT audio_object_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES audio_version(id) DEFERRABLE INITIALLY DEFERRED`.execute(
    db,
  );

  await sql`
    CREATE TABLE audio_source (
      id text PRIMARY KEY CHECK (id ~ '^asr_[0-9A-HJKMNP-TV-Z]{26}$'),
      audio_version_id text NOT NULL REFERENCES audio_version(id),
      workspace_id text NOT NULL REFERENCES workspace(id),
      origin text NOT NULL CHECK (origin IN ('catalog','private_upload','audio_log')),
      visibility text NOT NULL CHECK (visibility IN ('private','public')),
      status text NOT NULL CHECK (status IN ('processing','ready','failed','deleting','deleted')),
      title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200),
      created_by text REFERENCES app_user(id),
      failure_code text,
      storage_prefix text NOT NULL UNIQUE,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- catalog <=> public; user origins are always private (domain-model §3.2)
      CHECK ((origin = 'catalog') = (visibility = 'public')),
      CHECK ((status IN ('deleting','deleted')) = (deleted_at IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX audio_source_ws_idx ON audio_source (workspace_id, status, created_at DESC, id)`.execute(
    db,
  );
  await sql`CREATE INDEX audio_source_version_idx ON audio_source (audio_version_id)`.execute(db);

  await sql`
    CREATE TABLE audio_asset (
      id text PRIMARY KEY CHECK (id ~ '^ast_[0-9A-HJKMNP-TV-Z]{26}$'),
      audio_source_id text NOT NULL REFERENCES audio_source(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('original','hls','waveform')),
      bucket text NOT NULL CHECK (bucket LIKE 'rabit-private-%' OR bucket LIKE 'rabit-catalog-%'),
      object_key text NOT NULL,
      sha256 char(64),
      bytes bigint NOT NULL CHECK (bytes >= 0),
      codec text,
      tool_version text,
      encryption_key_ref text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (bucket, object_key),
      UNIQUE (audio_source_id, kind)
    )`.execute(db);

  await sql`
    CREATE TABLE upload_session (
      id text PRIMARY KEY CHECK (id ~ '^upl_[0-9A-HJKMNP-TV-Z]{26}$'),
      workspace_id text NOT NULL REFERENCES workspace(id),
      created_by text NOT NULL REFERENCES app_user(id),
      intent text NOT NULL CHECK (intent IN ('private_upload','audio_log')),
      declared_bytes bigint NOT NULL CHECK (declared_bytes > 0),
      declared_sha256 char(64) NOT NULL CHECK (declared_sha256 ~ '^[0-9a-f]{64}$'),
      declared_content_type text,
      default_title text,
      quarantine_key text NOT NULL UNIQUE,
      state text NOT NULL CHECK (state IN
        ('created','uploading','quarantined','processing','ready','failed','cancelled','expired')),
      reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),
      expires_at timestamptz NOT NULL,
      failure_code text,
      audio_source_id text REFERENCES audio_source(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX upload_session_ws_idx ON upload_session (workspace_id, state)`.execute(db);
  await sql`CREATE INDEX upload_session_expiry_idx ON upload_session (expires_at) WHERE state = 'created'`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS upload_session`.execute(db);
  await sql`DROP TABLE IF EXISTS audio_asset`.execute(db);
  await sql`DROP TABLE IF EXISTS audio_source`.execute(db);
  await sql`ALTER TABLE IF EXISTS audio_object DROP CONSTRAINT IF EXISTS audio_object_current_version_fk`.execute(
    db,
  );
  await sql`DROP TABLE IF EXISTS audio_version`.execute(db);
  await sql`DROP TABLE IF EXISTS audio_object`.execute(db);
}
