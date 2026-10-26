# ADR-0033: Release date precision and time-cutoff eligibility

- Status: Proposed
- Date: 2026-10-26
- Deciders: product owner, engineering
- Related: [exploration expansion](../exploration_expansion/13-technical-design.md) §2–3, ADR-PROP-EX01 in [10-decisions-risks](../exploration_expansion/10-decisions-risks.md), ADR-0030 (DDEX ingest), Q-EXP-01

## Context
Time Radio and Artist Journey must never show music released after a chosen moment ("no future leaks"). `release.release_date` is a single nullable date without precision or market, so a year-only date stored as 1983-01-01 looks like January 1st and would leak into a 1983-06-15 cutoff.

## Options
1. **Precision column + derived latest date** (chosen proposal): `release_date_precision` (day/month/year, NULL = unknown) and a generated `release_date_latest`; eligible when `release_date_latest <= cutoff_date`.
2. Separate `historical_release_date` table with ranges, markets and sources (05-data-model): complete, but needs market data we do not have; deferred to E1 (D01).
3. Single date + unknown flag: simple but false precision.

## Decision (proposed)
- Option 1 now; option 2 later only for market-specific dates.
- A recording is released by a cutoff when its **earliest** release containing it is eligible.
- Unknown precision or no date → excluded from cutoff queries and listed as undated.
- Precision is set by ingest from the source format; backfill marks `day` only for sources with full dates.
- The cutoff date is the calendar date of the cutoff instant in the chosen time zone.

## Consequences
- Some releases disappear from time-bound views until their precision is known; coverage counts show how many.
- Reissue dates may still be later than the original; the earliest-release rule mitigates it for recordings.
- Migration is additive; rollback drops two columns and an index.

## Revisit trigger
Market-specific dates (D01), or a source that provides original-release dates per recording.
