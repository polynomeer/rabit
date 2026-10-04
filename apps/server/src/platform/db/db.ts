import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// int8 (bigint) columns hold byte sizes and durations well below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// numeric columns (confidence, percentile) are returned as numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// date columns (release dates) stay as ISO `YYYY-MM-DD` strings, independent of time zones.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;
/** Either a plain connection or an open transaction. */
export type DbOrTx = Kysely<Database>;

export function createDb(url: string, poolMax = 10): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: url,
        max: poolMax,
        // Fail fast instead of hanging requests when the database is unreachable.
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        application_name: 'rabit',
      }),
    }),
  });
}

export async function pingDb(db: Db): Promise<void> {
  await sql`select 1`.execute(db);
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
