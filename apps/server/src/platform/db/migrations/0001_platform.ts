import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Platform tables: job queue, outbox, audit log, idempotency records (ADR-0005).
 * Rollback: drops the tables; only operational data is lost.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  await sql`
    CREATE TABLE job (
      id text PRIMARY KEY CHECK (id ~ '^job_[0-9A-HJKMNP-TV-Z]{26}$'),
      kind text NOT NULL,
      payload jsonb NOT NULL,
      dedupe_key text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed','dead')),
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
      run_after timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_until timestamptz,
      last_error text,
      correlation_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX job_ready_idx ON job (run_after) WHERE status = 'queued'`.execute(db);
  await sql`CREATE INDEX job_lease_idx ON job (locked_until) WHERE status = 'running'`.execute(db);
  await sql`CREATE INDEX job_status_idx ON job (status, updated_at DESC)`.execute(db);

  await sql`
    CREATE TABLE outbox_event (
      id text PRIMARY KEY CHECK (id ~ '^evt_[0-9A-HJKMNP-TV-Z]{26}$'),
      type text NOT NULL,
      schema_version integer NOT NULL,
      subject_id text NOT NULL,
      workspace_id text,
      privacy_scope text NOT NULL CHECK (privacy_scope IN ('private','catalog','system')),
      correlation_id text,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      payload jsonb NOT NULL,
      dispatched_at timestamptz
    )`.execute(db);
  await sql`CREATE INDEX outbox_pending_idx ON outbox_event (occurred_at) WHERE dispatched_at IS NULL`.execute(
    db,
  );

  await sql`
    CREATE TABLE audit_log (
      id text PRIMARY KEY CHECK (id ~ '^adl_[0-9A-HJKMNP-TV-Z]{26}$'),
      actor_type text NOT NULL CHECK (actor_type IN ('user','operator','system')),
      actor_id text,
      action text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      reason text,
      correlation_id text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX audit_subject_idx ON audit_log (subject_type, subject_id, at)`.execute(db);
  // Append-only: block UPDATE/DELETE for every role except via superuser maintenance.
  await sql`
    CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()`.execute(db);

  await sql`
    CREATE TABLE idempotency_record (
      user_id text NOT NULL,
      operation text NOT NULL,
      idempotency_key text NOT NULL,
      request_hash char(64) NOT NULL,
      response_status integer,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, operation, idempotency_key)
    )`.execute(db);
  await sql`CREATE INDEX idempotency_created_idx ON idempotency_record (created_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS idempotency_record`.execute(db);
  await sql`DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log`.execute(db);
  await sql`DROP TABLE IF EXISTS audit_log`.execute(db);
  await sql`DROP FUNCTION IF EXISTS audit_log_append_only()`.execute(db);
  await sql`DROP TABLE IF EXISTS outbox_event`.execute(db);
  await sql`DROP TABLE IF EXISTS job`.execute(db);
  // pg_trgm is left installed: other databases objects may depend on it.
}
