# ADR-0025: Monthly usage statements for rights holders

- Status: Accepted (counting rule, month, retention, export) / **Proposed (per-society report formats, fraud filtering, statement retention end)**
- Date: 2026-10-20
- Deciders: product owner (30-second rule, report by month), engineering
- Related: ADR-0016 (rights and entitlement), ADR-0005 (jobs, retention), PLY-015, Q02, audio pipeline review 2026-10-20

## Context
Catalog licences and collecting societies are paid on usage: how often each recording was played, in which territory, and under which access (subscription or purchase). Rabit recorded server-validated listening events, but nothing turned them into a report. The events were also purged after 90 days and deleted with an account, so a month's usage could vanish before anyone reported it.

## Options
Counting rule: (1) **30 s, or half of a track shorter than 30 s; at most one stream per playback session** (chosen, owner decision; common industry practice); (2) any start; (3) contract-specific rules only.
When a month is final: (1) **closed once, three days after it ends (Asia/Seoul), then immutable** (chosen); (2) recomputed on demand from raw events, which retention and deletions would change.
Deleted accounts: (1) **their qualifying streams of open months stay as anonymous carry-over rows** (chosen); (2) dropped with the account, which under-reports to rights holders.

## Decision
- **Stream**
  - A stream is one catalog playback session whose accepted `played_ms` reaches 30 s, or half the recording's duration when that is under 30 s.
  - Listening time is checked against the wall clock on arrival (PLY-015), so client-claimed time alone never counts.
  - A session counts once however often it was replayed or sought.
- **What a line records**
  - A session records the account's licence territory and the access it was granted under (`subscription`, `purchase`, `grant`) at issue time.
  - It belongs to the month (Asia/Seoul) in which it was issued.
- **Closing a month**
  - `playback.close_usage_statements` runs every 6 hours.
  - It closes each of the last three months that ended at least 3 days ago and is not closed yet, oldest first.
  - It writes `usage_statement` (month, policy `usage/v1`, totals) and one `usage_statement_line` per recording, rights grant, territory and access.
  - Each line holds the ISRC, rights holder and contract reference, plus `streams`, `listeners` (a count) and `played_ms`.
  - Database triggers refuse updates and deletes of closed statements.
  - The down migration refuses to drop them (`MIGRATION_ALLOW_DATA_LOSS`).
- **Retention**
  - Raw listening events are purged after 90 days, and only once their month is closed.
  - Closed statements carry no user data. They are kept at least 5 years, and nothing deletes them yet.
- **Account deletion**
  - The account's qualifying streams of months not yet closed are folded into `usage_carryover` before its listening events are deleted.
  - Carry-over rows hold month, recording, grant, territory, access, streams and time, with no user reference.
  - Closing a month adds them in and consumes them.
  - An advisory lock serialises closing and folding.
- **Export**
  - `GET /v1/ops/usage-statements` lists statements.
  - `GET /v1/ops/usage-statements/{month}/lines?format=json|csv` returns the lines; the CSV follows RFC 4180, one row per line.
  - Operators only, and every export is audited.
- **Metric:** `rabit_usage_streams_closed_total`.

## Consequences
- Each closed month is a fixed record that does not depend on later retention or deletions.
- Private uploads and Audio Logs are never reported: they have no rights grant.

## Still open (Proposed)
- Report formats per society or label: DDEX DSR or society templates.
- Rate and price allocation (pro-rata or user-centric).
- Fraud and bot filtering beyond the wall-clock check, for example per-user daily caps.
- When statements may be deleted.

## Revisit trigger
The first licence or society contract (Q02), which sets its own counting rules and report format.
