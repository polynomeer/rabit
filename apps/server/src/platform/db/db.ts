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

/**
 * `onIdleError` receives errors of idle pooled connections, for example when the
 * database restarts. The pool discards that connection and opens a new one on
 * the next query; without a listener the error would crash the process.
 */
export interface DbTimeouts {
  /** Server-side limit per statement (0 = none, e.g. for migrations). */
  statementMs: number;
  /** A transaction left idle this long is ended by the server (0 = none). */
  idleInTransactionMs: number;
}

export function createDb(
  url: string,
  poolMax = 10,
  onIdleError: (err: Error) => void = () => {},
  timeouts: DbTimeouts = { statementMs: 0, idleInTransactionMs: 0 },
): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    // Fail fast instead of hanging requests when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'rabit',
    // A runaway query or a transaction left open must not hold locks and the
    // vacuum horizon for the hot tables (job, outbox, rate-limit counters).
    ...(timeouts.statementMs > 0 ? { statement_timeout: timeouts.statementMs } : {}),
    ...(timeouts.idleInTransactionMs > 0
      ? { idle_in_transaction_session_timeout: timeouts.idleInTransactionMs }
      : {}),
  });
  pool.on('error', onIdleError);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export async function pingDb(db: Db): Promise<void> {
  await sql`select 1`.execute(db);
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
