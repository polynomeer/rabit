import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Release date precision (ADR-0033): a release date is a day, a month or a year, and
 * `release_date_latest` is the last day the release could have come out. Time-bound
 * views (Time Radio, Artist Journey) use it so a year-only date never leaks into an
 * earlier cutoff. Unknown precision stays NULL and is excluded from those views.
 *
 * Existing dates came only from the manifest and DDEX ingest, which accepted full
 * dates (DDEX dropped partial ones), so they are days.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE release
      ADD COLUMN release_date_precision text
        CHECK (release_date_precision IN ('day', 'month', 'year')),
      ADD CONSTRAINT release_precision_needs_date
        CHECK (release_date_precision IS NULL OR release_date IS NOT NULL);
    UPDATE release SET release_date_precision = 'day' WHERE release_date IS NOT NULL;
    ALTER TABLE release
      -- date_trunc is not immutable for dates (it goes through timestamptz), so the
      -- month end is built from the first of the month with immutable date arithmetic.
      ADD COLUMN release_date_latest date GENERATED ALWAYS AS (
        CASE release_date_precision
          WHEN 'day' THEN release_date
          WHEN 'month' THEN ((release_date - (EXTRACT(day FROM release_date)::int - 1))
            + interval '1 month - 1 day')::date
          WHEN 'year' THEN make_date(EXTRACT(year FROM release_date)::int, 12, 31)
        END
      ) STORED;
    CREATE INDEX release_date_latest_idx ON release (release_date_latest)
      WHERE release_date_latest IS NOT NULL;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    DROP INDEX release_date_latest_idx;
    ALTER TABLE release
      DROP COLUMN release_date_latest,
      DROP CONSTRAINT release_precision_needs_date,
      DROP COLUMN release_date_precision;
  `,
    )
    .execute(db);
}
