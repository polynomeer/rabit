import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Listening events and derived popularity (PLY-015, DIG-007) and DIG sessions /
 * trails (DIG-005). Raw listening events are retained 90 days (NFR-PRV-005).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE listening_event (
      id text PRIMARY KEY CHECK (id ~ '^lev_[0-9A-HJKMNP-TV-Z]{26}$'),
      session_id text NOT NULL REFERENCES playback_session(id),
      user_id text NOT NULL REFERENCES app_user(id),
      recording_id text REFERENCES recording(id),
      client_event_id uuid NOT NULL,
      sequence integer NOT NULL CHECK (sequence >= 0),
      type text NOT NULL CHECK (type IN ('started','heartbeat','seek','paused','ended')),
      position_ms bigint NOT NULL CHECK (position_ms >= 0),
      played_ms bigint NOT NULL CHECK (played_ms >= 0),
      client_time timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      accepted boolean NOT NULL,
      reject_reason text,
      UNIQUE (session_id, client_event_id)
    )`.execute(db);
  await sql`CREATE INDEX listening_event_recording_idx ON listening_event (recording_id, received_at) WHERE accepted`.execute(
    db,
  );
  await sql`CREATE INDEX listening_event_session_idx ON listening_event (session_id, received_at)`.execute(
    db,
  );

  await sql`
    CREATE TABLE recording_popularity (
      recording_id text PRIMARY KEY REFERENCES recording(id) ON DELETE CASCADE,
      window_days integer NOT NULL,
      distinct_listeners integer NOT NULL CHECK (distinct_listeners >= 0),
      plays integer NOT NULL CHECK (plays >= 0),
      percentile numeric(5,4) CHECK (percentile IS NULL OR (percentile >= 0 AND percentile <= 1)),
      tier text NOT NULL CHECK (tier IN ('top','upper','deep_cut','obscure','unknown')),
      policy_version text NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE dig_session (
      id text PRIMARY KEY CHECK (id ~ '^dgs_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      start_entity_id text REFERENCES music_entity(id),
      start_audio_source_id text REFERENCES audio_source(id),
      state text NOT NULL CHECK (state IN ('active','ended')),
      title text CHECK (title IS NULL OR char_length(title) <= 200),
      saved boolean NOT NULL DEFAULT false,
      visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
      current_seq integer NOT NULL DEFAULT 0,
      started_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz,
      CHECK (start_entity_id IS NOT NULL OR start_audio_source_id IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX dig_session_user_idx ON dig_session (user_id, started_at DESC, id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE dig_trail_node (
      id text PRIMARY KEY CHECK (id ~ '^dgn_[0-9A-HJKMNP-TV-Z]{26}$'),
      session_id text NOT NULL REFERENCES dig_session(id) ON DELETE CASCADE,
      seq integer NOT NULL CHECK (seq >= 0),
      parent_seq integer,
      entity_id text NOT NULL REFERENCES music_entity(id),
      via_axis text,
      via_relation_id text REFERENCES music_relation(id),
      via_credit_id text REFERENCES credit(id),
      via_evidence jsonb,
      played boolean NOT NULL DEFAULT false,
      saved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (session_id, seq),
      CHECK ((seq = 0) = (parent_seq IS NULL))
    )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS dig_trail_node`.execute(db);
  await sql`DROP TABLE IF EXISTS dig_session`.execute(db);
  await sql`DROP TABLE IF EXISTS recording_popularity`.execute(db);
  await sql`DROP TABLE IF EXISTS listening_event`.execute(db);
}
