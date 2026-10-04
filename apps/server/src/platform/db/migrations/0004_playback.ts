import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/** Playback sessions (ADR-0008, ADR-0016). Rights/entitlement references added in 0006. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE playback_session (
      id text PRIMARY KEY CHECK (id ~ '^pbs_[0-9A-HJKMNP-TV-Z]{26}$'),
      user_id text NOT NULL REFERENCES app_user(id),
      audio_source_id text NOT NULL REFERENCES audio_source(id),
      capability text NOT NULL CHECK (capability IN ('play')),
      device_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('active','expired','revoked')),
      issued_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      rights_grant_id text,
      rights_version integer,
      entitlement_id text,
      entitlement_version integer,
      refreshed_count integer NOT NULL DEFAULT 0,
      revoked_reason text
    )`.execute(db);
  await sql`CREATE INDEX playback_session_source_active ON playback_session (audio_source_id) WHERE status = 'active'`.execute(
    db,
  );
  await sql`CREATE INDEX playback_session_user_idx ON playback_session (user_id, issued_at DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS playback_session`.execute(db);
}
