import { sql, type RawBuilder } from 'kysely';
import type { DbOrTx } from './db/db.js';

/**
 * One module's part of the alpha validation metrics (ADR-0031): product validation over
 * a sign-up cohort, cohort aggregates only. Each module reads only its own tables (and
 * its listed read models), returns the days people acted and cohort-level counts, and
 * never titles, notes, content or a per-person value that leaves the server.
 */
export interface ValidationSection {
  name: string;
  /** The days (Asia/Seoul, `YYYY-MM-DD`) on which each of these people acted here. */
  activeDays(db: DbOrTx, userIds: readonly string[]): Promise<ActiveDay[]>;
  /** Counts over the whole cohort for the gate metrics, by name. */
  counts?(db: DbOrTx, userIds: readonly string[]): Promise<Record<string, number>>;
}

export interface ActiveDay {
  userId: string;
  day: string;
}

/** Validation days are calendar days in Korea, like usage statement months (ADR-0025). */
export const VALIDATION_TIME_ZONE = 'Asia/Seoul';

/** A timestamp column as its calendar day in Korea, `YYYY-MM-DD`. */
export function koreanDay(column: string): RawBuilder<string> {
  return sql<string>`to_char(${sql.ref(column)} at time zone ${VALIDATION_TIME_ZONE}, 'YYYY-MM-DD')`;
}
