import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Rate-limit counters shared by every api instance (R13, ADR-0020). UNLOGGED:
 * counters are disposable, so a crash may reset them but writes skip the WAL.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE UNLOGGED TABLE rate_limit_counter (
      key text PRIMARY KEY CHECK (length(key) <= 512),
      count integer NOT NULL CHECK (count > 0),
      window_ends_at timestamptz NOT NULL
    );
    CREATE INDEX rate_limit_counter_expiry_idx ON rate_limit_counter (window_ends_at);`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE rate_limit_counter`.execute(db);
}
