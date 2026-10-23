import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Client error groups (ADR-0027): one row per distinct error, keyed by a fingerprint
 * the server computes. Nothing links a row to a user; rows unseen for 30 days are
 * deleted.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE client_error_group (
      fingerprint text PRIMARY KEY,
      platform text NOT NULL CHECK (platform IN ('web', 'ios')),
      kind text NOT NULL CHECK (kind IN ('error', 'unhandled', 'crash', 'hang')),
      name text NOT NULL,
      message text NOT NULL,
      frames jsonb NOT NULL,
      count bigint NOT NULL,
      first_app_version text NOT NULL,
      last_app_version text NOT NULL,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX client_error_group_last_seen ON client_error_group (last_seen_at);
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE client_error_group`.execute(db);
}
