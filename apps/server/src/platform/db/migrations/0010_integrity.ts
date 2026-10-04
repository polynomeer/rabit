import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

const VERIFICATION =
  "('self_declared','distributor_verified','signature_valid','process_evidence_reviewed','rights_reviewed')";

/**
 * Music Integrity (TRU-001..012, ADR-0017): provenance claims, independent
 * integrity axes, and user reports (distinct from automated signals).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE provenance_claim (
      id text PRIMARY KEY CHECK (id ~ '^prc_[0-9A-HJKMNP-TV-Z]{26}$'),
      subject_entity_id text NOT NULL REFERENCES music_entity(id),
      claim_type text NOT NULL CHECK (claim_type IN ('creation_method','rights_statement')),
      stage text CHECK (stage IN ('composition','lyrics','vocals','instruments','mixing','mastering','artwork')),
      value text NOT NULL,
      issuer text NOT NULL,
      basis text NOT NULL CHECK (basis IN ('verified_fact','declared','ml_inferred')),
      verification_state text NOT NULL CHECK (verification_state IN ${VERIFICATION}),
      evidence_ref text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((claim_type = 'creation_method') = (stage IS NOT NULL)),
      CHECK (claim_type <> 'creation_method' OR value IN ('human','ai_assisted','ai_generated','unknown'))
    )`,
    )
    .execute(db);
  await sql`CREATE INDEX provenance_claim_subject_idx ON provenance_claim (subject_entity_id)`.execute(
    db,
  );

  await sql`
    CREATE TABLE integrity_signal (
      id text PRIMARY KEY CHECK (id ~ '^isg_[0-9A-HJKMNP-TV-Z]{26}$'),
      subject_entity_id text NOT NULL REFERENCES music_entity(id),
      axis text NOT NULL CHECK (axis IN
        ('ai_generation','technical_quality','spam_risk','rights_status','recommendation_eligibility')),
      value text NOT NULL,
      basis text NOT NULL CHECK (basis IN ('declared','automated','reviewed')),
      internal_score numeric(5,4) CHECK (internal_score IS NULL OR (internal_score >= 0 AND internal_score <= 1)),
      model_version text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (basis <> 'automated' OR model_version IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX integrity_signal_subject_idx ON integrity_signal (subject_entity_id, axis, created_at DESC)`.execute(
    db,
  );

  await sql`
    CREATE TABLE report (
      id text PRIMARY KEY CHECK (id ~ '^rpt_[0-9A-HJKMNP-TV-Z]{26}$'),
      reporter_user_id text NOT NULL REFERENCES app_user(id),
      subject_type text NOT NULL CHECK (subject_type IN ('recording','release','artist','relation','credit')),
      subject_id text NOT NULL,
      reason_code text NOT NULL CHECK (reason_code IN
        ('wrong_credit','wrong_relation','undisclosed_ai','spam','impersonation','rights_infringement','other')),
      details text CHECK (details IS NULL OR char_length(details) <= 2000),
      status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','triaged','actioned','dismissed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX report_status_idx ON report (status, created_at)`.execute(db);
  await sql`CREATE INDEX report_reporter_idx ON report (reporter_user_id, created_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS report`.execute(db);
  await sql`DROP TABLE IF EXISTS integrity_signal`.execute(db);
  await sql`DROP TABLE IF EXISTS provenance_claim`.execute(db);
}
