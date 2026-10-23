import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Feature flag overrides (ADR-0028). Flags are declared in code with a default; a row
 * here overrides it for this environment.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE feature_flag (
      key text PRIMARY KEY,
      enabled boolean NOT NULL,
      rollout_percent integer NOT NULL CHECK (rollout_percent BETWEEN 0 AND 100),
      updated_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE feature_flag`.execute(db);
}
