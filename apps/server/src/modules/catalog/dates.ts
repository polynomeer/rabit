import { sql } from 'kysely';
import type { Db } from '../../platform/db/db.js';
import type { ReleaseDatePrecision } from '../../platform/db/schema.js';

/**
 * Release-date rules for exploration (ADR-0033). A release counts as out by a
 * cutoff only when the last day it could have come out (`release_date_latest`,
 * from the date and its precision) is on or before the cutoff date, so a
 * year-only "1983" release is out only from 1983-12-31. Releases with an
 * unknown date or precision never count. A recording is out by the cutoff when
 * its earliest release containing it is, so a 2010 reissue does not hide a 1983
 * original and does not leak a later track into an earlier year.
 */

/** The calendar date (YYYY-MM-DD) of `at` in `timeZone`. */
export function cutoffDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A stored date shown with no more precision than it has (EXP-024). */
export function datePrecise(
  date: string | null,
  precision: ReleaseDatePrecision | null,
): string | null {
  if (!date || !precision) return null;
  if (precision === 'year') return date.slice(0, 4);
  if (precision === 'month') return date.slice(0, 7);
  return date.slice(0, 10);
}

/**
 * Of `recordingIds`, those out by `cutoff` (YYYY-MM-DD), with the last possible
 * day of their earliest release.
 */
export async function recordingsOutBy(
  db: Db,
  recordingIds: readonly string[],
  cutoff: string,
): Promise<Map<string, string>> {
  if (!recordingIds.length) return new Map();
  const rows = await db
    .selectFrom('release_track as rt')
    .innerJoin('release as r', 'r.id', 'rt.release_id')
    .where('rt.recording_id', 'in', recordingIds)
    .where('r.release_date_latest', 'is not', null)
    .groupBy('rt.recording_id')
    .having(sql<string>`min(r.release_date_latest)`, '<=', cutoff)
    .select(['rt.recording_id', sql<string>`min(r.release_date_latest)::text`.as('first_latest')])
    .execute();
  return new Map(rows.map((r) => [r.recording_id, r.first_latest]));
}
