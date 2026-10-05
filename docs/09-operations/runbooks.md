# Runbooks

- Status: Phase 20 (2026-10-04). Operator API requires the operator role with MFA; every action takes a `reason` and is audited. First principle for incidents: **stop new access/processing, preserve evidence, then repair** (AP-12).

## api-errors
1. Check `/readyz` on api instances: `database` or `storage` down?
2. Database down: writes fail closed (no fallback); new playback sessions are refused — this is intended (NFR-REL-009). Restore DB; no data repair needed for idempotent jobs.
3. Storage down: uploads/finalize fail with 5xx; transcoding jobs retry with backoff and land in DLQ after 5 attempts → see dead-letter-queue after recovery.
4. Look up affected requests by `request_id` from user reports.

## playback-failures
1. `rabit_playback_decisions_total` — are denials rising for one reason (`rights_unavailable` after a grant change, `subscription_required` after an entitlement job failure)?
2. `rabit_media_requests_total{outcome}`: `bad_token` → clock skew or `MEDIA_TOKEN_SECRET` mismatch between api and media; `session_inactive` → sessions expired (client refresh broken) or revoked; `missing` → derivative objects missing (restore or re-process the source via job retry).

## queue-backlog
1. `rabit_jobs{status}` and `rabit_job_oldest_queued_seconds`. Are workers running? Each worker logs `worker started`.
2. Stuck `running` jobs are reclaimed when their lease expires (hourly housekeeping + every worker every 30 s).
3. Scale workers horizontally; the queue is safe for concurrent workers (`SKIP LOCKED`).

## dead-letter-queue
1. `GET /v1/ops/jobs?status=dead` (payloads are never shown).
2. Read `last_error`. Permanent media failures (`UNSUPPORTED_MEDIA`, `CORRUPT_MEDIA`, `DURATION_EXCEEDED`, `CHECKSUM_MISMATCH`) are user-facing outcomes, do **not** retry. Transient (`PROCESSING_FAILED`) → fix the dependency, then `POST /v1/ops/jobs/{id}/retry` with a reason. The source returns to `processing` and the quarantined upload is still there (kept for 2 days).

## rights-revocation-not-applied
Contract risk; treat as urgent.
1. New sessions are already refused synchronously by the policy. Check active sessions under the grant: `SELECT count(*) FROM playback_session WHERE rights_grant_id = $1 AND status = 'active'`.
2. If the outbox/queue is lagging, see queue-backlog. Media requests still fail within ≤ 60 s because media tokens expire and refresh re-checks the policy.
3. Record the incident (time from grant change to last served segment) for the rights holder report.

## private-data-exposure
1. Revoke access first: delete or tombstone the exposed sources (`DELETE /v1/audio-sources/:id` as owner, or a DB tombstone by on-call with approval), revoke sessions.
2. Preserve logs (request ids) and determine scope. Every private read path is tested by negative tests (threat model T04/T05); find the path that bypassed `getOwnSource` / the policy / the search scope predicate.
3. Notification obligations: Legal decides by jurisdiction (NFR-PRV-010); never improvise deadlines.

## account-deletion-stuck
`identity.delete_account` is idempotent: retry it from the DLQ. Each module deleter can be re-run safely.

## backup-restore
After restoring a backup, re-run deletion for accounts with `status in ('deletion_requested','deleted')` and sources with `deleted_at IS NOT NULL` (tombstones re-applied, LIB-008) before opening traffic. This also covers catalog audio removed by operators (R10): its source is tombstoned. Removals made after the backup was taken are in the audit log (`action = 'recording.audio_removed'`, `details.audio_source_id`) and must be re-applied too.

## slow-queries
Check `pg_stat_statements`; search uses GIN (tsv, trigram); DIG uses `(from_entity_id, relation_type)` / credit contributor indexes. Compare with [performance-baseline](../10-testing/performance-baseline.md).

## listening-anomalies
High `rejected` share: inspect `reject_reason` distribution in `listening_event`. `played_exceeds_wall_clock` from many accounts → client bug; from a few → manipulation (exclude accounts from popularity, P1 fraud tooling).

## rate-limit-store
`RateLimitStoreFailing`: counter updates to `rate_limit_counter` fail and requests pass unlimited (ADR-0020). Check database health first: the api is usually failing too. If only the counters fail, check the table exists (migration `0011_rate_limit`) and its size (`SELECT count(*) FROM rate_limit_counter`). Expired rows are purged by the worker, so a large table means the worker is down. `UNLOGGED` tables are emptied after a crash, which only resets counters.
