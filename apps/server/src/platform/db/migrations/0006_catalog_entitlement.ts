import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

const VERIFICATION =
  "('self_declared','distributor_verified','signature_valid','process_evidence_reviewed','rights_reviewed')";
const BASIS = "('verified_fact','declared','ml_inferred')";

/**
 * Catalog (MusicEntity registry, recordings, releases, credits, relations),
 * rights grants, subscriptions and entitlements (ADR-0016, ADR-0017, erd §2).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE music_entity (
      id text PRIMARY KEY,
      entity_type text NOT NULL CHECK (entity_type IN ('artist','person','label','release','recording')),
      display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 300),
      sort_name text NOT NULL,
      search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', display_name)) STORED,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (entity_type = 'artist' AND id ~ '^art_[0-9A-HJKMNP-TV-Z]{26}$') OR
        (entity_type = 'person' AND id ~ '^per_[0-9A-HJKMNP-TV-Z]{26}$') OR
        (entity_type = 'label' AND id ~ '^lbl_[0-9A-HJKMNP-TV-Z]{26}$') OR
        (entity_type = 'release' AND id ~ '^rel_[0-9A-HJKMNP-TV-Z]{26}$') OR
        (entity_type = 'recording' AND id ~ '^rec_[0-9A-HJKMNP-TV-Z]{26}$')
      )
    )`.execute(db);
  await sql`CREATE INDEX music_entity_tsv_idx ON music_entity USING gin (search_tsv)`.execute(db);
  await sql`CREATE INDEX music_entity_trgm_idx ON music_entity USING gin (display_name gin_trgm_ops)`.execute(
    db,
  );

  await sql`
    CREATE TABLE recording (
      id text PRIMARY KEY REFERENCES music_entity(id),
      title text NOT NULL,
      isrc text UNIQUE CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
      duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
      catalog_audio_source_id text UNIQUE REFERENCES audio_source(id)
    )`.execute(db);
  await sql`
    CREATE TABLE recording_artist (
      recording_id text NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
      artist_id text NOT NULL REFERENCES music_entity(id),
      ord integer NOT NULL,
      PRIMARY KEY (recording_id, artist_id)
    )`.execute(db);
  await sql`CREATE INDEX recording_artist_artist_idx ON recording_artist (artist_id)`.execute(db);

  await sql`
    CREATE TABLE release (
      id text PRIMARY KEY REFERENCES music_entity(id),
      title text NOT NULL,
      release_type text NOT NULL CHECK (release_type IN ('album','single','ep','compilation')),
      label_id text REFERENCES music_entity(id),
      release_date date,
      upc text UNIQUE
    )`.execute(db);
  await sql`CREATE INDEX release_label_idx ON release (label_id)`.execute(db);
  await sql`
    CREATE TABLE release_artist (
      release_id text NOT NULL REFERENCES release(id) ON DELETE CASCADE,
      artist_id text NOT NULL REFERENCES music_entity(id),
      ord integer NOT NULL,
      PRIMARY KEY (release_id, artist_id)
    )`.execute(db);
  await sql`CREATE INDEX release_artist_artist_idx ON release_artist (artist_id)`.execute(db);
  await sql`
    CREATE TABLE release_track (
      release_id text NOT NULL REFERENCES release(id) ON DELETE CASCADE,
      disc_no integer NOT NULL DEFAULT 1 CHECK (disc_no >= 1),
      position integer NOT NULL CHECK (position >= 1),
      recording_id text NOT NULL REFERENCES recording(id),
      PRIMARY KEY (release_id, disc_no, position)
    )`.execute(db);
  await sql`CREATE INDEX release_track_recording_idx ON release_track (recording_id)`.execute(db);

  await sql
    .raw(
      `
    CREATE TABLE credit (
      id text PRIMARY KEY CHECK (id ~ '^crd_[0-9A-HJKMNP-TV-Z]{26}$'),
      subject_entity_id text NOT NULL REFERENCES music_entity(id),
      contributor_entity_id text NOT NULL REFERENCES music_entity(id),
      role text NOT NULL CHECK (role IN ('composer','lyricist','producer','engineer','mixing_engineer',
        'mastering_engineer','performer','featured_artist','arranger')),
      instrument text,
      creation_method text NOT NULL DEFAULT 'unknown'
        CHECK (creation_method IN ('human','ai_assisted','ai_generated','unknown')),
      basis text NOT NULL CHECK (basis IN ${BASIS}),
      verification_state text NOT NULL CHECK (verification_state IN ${VERIFICATION}),
      source text NOT NULL,
      evidence_ref text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (subject_entity_id <> contributor_entity_id)
    )`,
    )
    .execute(db);
  await sql`CREATE UNIQUE INDEX credit_unique ON credit (subject_entity_id, contributor_entity_id, role, coalesce(instrument, ''))`.execute(
    db,
  );
  await sql`CREATE INDEX credit_contributor_idx ON credit (contributor_entity_id, role)`.execute(
    db,
  );

  await sql
    .raw(
      `
    CREATE TABLE music_relation (
      id text PRIMARY KEY CHECK (id ~ '^mrl_[0-9A-HJKMNP-TV-Z]{26}$'),
      from_entity_id text NOT NULL REFERENCES music_entity(id),
      to_entity_id text NOT NULL REFERENCES music_entity(id),
      relation_type text NOT NULL
        CHECK (relation_type IN ('samples','covers','remix_of','influenced_by','member_of','signed_to')),
      basis text NOT NULL CHECK (basis IN ${BASIS}),
      confidence numeric(4,3),
      verification_state text NOT NULL CHECK (verification_state IN ${VERIFICATION}),
      source text NOT NULL,
      evidence_ref text,
      license_status text NOT NULL DEFAULT 'unknown'
        CHECK (license_status IN ('unknown','licensed','not_applicable')),
      valid_from date,
      valid_to date,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (from_entity_id <> to_entity_id),
      CHECK (basis <> 'ml_inferred' OR (confidence > 0 AND confidence <= 1)),
      CHECK (basis <> 'verified_fact' OR verification_state <> 'self_declared'),
      UNIQUE (from_entity_id, to_entity_id, relation_type, source)
    )`,
    )
    .execute(db);
  await sql`CREATE INDEX music_relation_from_idx ON music_relation (from_entity_id, relation_type)`.execute(
    db,
  );
  await sql`CREATE INDEX music_relation_to_idx ON music_relation (to_entity_id, relation_type)`.execute(
    db,
  );

  await sql`
    CREATE TABLE rights_grant (
      id text PRIMARY KEY CHECK (id ~ '^rgt_[0-9A-HJKMNP-TV-Z]{26}$'),
      recording_id text NOT NULL REFERENCES recording(id),
      rights_holder text NOT NULL,
      territories text[] NOT NULL CHECK (cardinality(territories) >= 1),
      uses text[] NOT NULL CHECK (cardinality(uses) >= 1
        AND uses <@ ARRAY['stream','download','preview','transform','stem','analysis']::text[]),
      valid_from timestamptz NOT NULL,
      valid_to timestamptz,
      status text NOT NULL CHECK (status IN ('active','suspended','revoked','expired')),
      contract_ref text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    )`.execute(db);
  await sql`CREATE INDEX rights_grant_recording_idx ON rights_grant (recording_id, status)`.execute(
    db,
  );

  await sql`
    CREATE TABLE subscription (
      id text PRIMARY KEY CHECK (id ~ '^sub_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      plan text NOT NULL,
      state text NOT NULL CHECK (state IN ('active','past_due','cancelled','expired')),
      paid_through timestamptz NOT NULL,
      source text NOT NULL CHECK (source IN ('operator','sandbox')),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX subscription_one_per_user ON subscription (user_id)`.execute(db);

  await sql`
    CREATE TABLE entitlement (
      id text PRIMARY KEY CHECK (id ~ '^enl_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      scope text NOT NULL CHECK (scope IN ('catalog_all','release','recording')),
      resource_id text REFERENCES music_entity(id),
      capabilities text[] NOT NULL CHECK (cardinality(capabilities) >= 1),
      origin text NOT NULL CHECK (origin IN ('subscription','purchase','grant')),
      origin_ref text NOT NULL,
      valid_from timestamptz NOT NULL DEFAULT now(),
      valid_to timestamptz,
      status text NOT NULL CHECK (status IN ('active','suspended','revoked','expired')),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((scope = 'catalog_all') = (resource_id IS NULL)),
      CHECK ((scope = 'catalog_all') = (origin = 'subscription'))
    )`.execute(db);
  await sql`CREATE INDEX entitlement_user_idx ON entitlement (user_id, status)`.execute(db);
  await sql`CREATE UNIQUE INDEX entitlement_one_subscription ON entitlement (user_id) WHERE origin = 'subscription'`.execute(
    db,
  );

  await sql`
    ALTER TABLE audio_version ADD CONSTRAINT audio_version_recording_fk
      FOREIGN KEY (recording_id) REFERENCES recording(id)`.execute(db);
  await sql`
    ALTER TABLE audio_log ADD CONSTRAINT audio_log_recording_fk
      FOREIGN KEY (linked_recording_id) REFERENCES recording(id) ON DELETE SET NULL`.execute(db);
  await sql`CREATE INDEX playback_session_grant_active ON playback_session (rights_grant_id) WHERE status = 'active'`.execute(
    db,
  );
  await sql`CREATE INDEX playback_session_entitlement_active ON playback_session (entitlement_id) WHERE status = 'active'`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS playback_session_entitlement_active`.execute(db);
  await sql`DROP INDEX IF EXISTS playback_session_grant_active`.execute(db);
  await sql`ALTER TABLE audio_log DROP CONSTRAINT IF EXISTS audio_log_recording_fk`.execute(db);
  await sql`ALTER TABLE audio_version DROP CONSTRAINT IF EXISTS audio_version_recording_fk`.execute(
    db,
  );
  for (const t of [
    'entitlement',
    'subscription',
    'rights_grant',
    'music_relation',
    'credit',
    'release_track',
    'release_artist',
    'release',
    'recording_artist',
    'recording',
    'music_entity',
  ]) {
    await sql.raw(`DROP TABLE IF EXISTS ${t}`).execute(db);
  }
}
