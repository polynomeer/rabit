# Runbooks

- Status: Phase 20 (2026-10-04). Operator API requires the operator role with MFA; every action takes a `reason` and is audited. First principle for incidents: **stop new access/processing, preserve evidence, then repair** (AP-12).

Rehearse locally with `pnpm gameday` (after `pnpm build`): it breaks storage, the database and the worker on isolated containers and checks the behaviour described below.

## api-errors
1. Check `/readyz` on api instances: `database` or `storage` down?
2. Database down: writes fail closed (no fallback); new playback sessions are refused — this is intended (NFR-REL-009). Restore DB; no data repair needed for idempotent jobs.
3. Storage down: uploads/finalize fail with 5xx; transcoding jobs retry with backoff and land in DLQ after 5 attempts → see dead-letter-queue after recovery.
4. Look up affected requests by `request_id` from user reports.

## playback-failures
1. `rabit_playback_decisions_total` — are denials rising for one reason (`rights_unavailable` after a grant change, `subscription_required` after an entitlement job failure)?
2. `rabit_media_requests_total{outcome}`: `bad_token` → clock skew or `MEDIA_TOKEN_SECRET` mismatch between api and media; `session_inactive` → sessions expired (client refresh broken) or revoked; `missing` → derivative objects missing (restore or re-process the source via job retry).

3. Segments fail only behind the CDN: `rabit_media_requests_total{kind="edge_segment"}` at the origin. `not_edge` means the CDN's `x-media-edge` header and the media task's `MEDIA_EDGE_SECRET` differ (redeploy after a secret change). Edge refusals (403 from the CloudFront Function) appear in CloudFront logs and metrics, not at the origin; after rotating `MEDIA_TOKEN_SECRET`, check that `tofu apply` also updated the KeyValueStore key `media-token-secret`.

## queue-backlog
1. `rabit_jobs{status}` and `rabit_job_oldest_queued_seconds{kind}`: which kind is waiting? Each worker logs `worker started` with its `pool`.
2. Media kinds (`audio.process`, `catalog.process`) run on the `transcoder` service, everything else on `worker` (ADR-0005 amendment 2026-10-20). Check the matching service's running tasks.
3. The transcoder scales on the CloudWatch metric `Rabit/<environment> MediaJobsReady` (alarms `*-media-backlog-high` / `-empty`). No data points means the general worker is down: it writes the metric.
4. A `catalog.process` backlog alone (`CatalogIngestBacklog`) is expected during a large delivery; raise `transcoder_max_count` if it must finish sooner. User uploads are claimed before catalog jobs.
5. Stuck `running` jobs are reclaimed when their lease expires (hourly housekeeping + every worker every 30 s).
6. Scale either service horizontally; the queue is safe for concurrent workers (`SKIP LOCKED`).

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
A database restore must never bring back what users or operators deleted (LIB-008, R10). Object storage is **not** rolled back with the database, so audio deleted after the backup is missing from storage while its restored row still says `ready`.

1. Restore the database; keep api, media and worker stopped (no traffic).
2. Run migrations (`migrate:up`; a no-op when the backup is on the current schema).
3. `restore:reconcile --dry-run`, review the report, then `restore:reconcile` (`node dist/entry/restore-reconcile.js` in the image). It:
   - queues deletion again for accounts still `deletion_requested` and for tombstoned sources not yet `deleted`;
   - finds `ready` sources whose original object is missing (deleted after the backup), tombstones them, detaches catalog recordings from them and audits `source.deletion_reapplied`; their deletion job removes the remaining objects and personal metadata;
   - lists `accountsToReview`: active accounts whose every source was missing.
4. Start the worker and wait for the queue to drain (`queue-backlog`), then open traffic.

Limits: an **account** deleted after the backup cannot be recognized from the database (the audit log is restored to the backup point too); check `accountsToReview` against support records. Deletions of catalog audio by operators after the backup are recognized by the missing object, not by the audit log. Rehearse with `drill:restore` (local; numbers in [release-readiness](../plans/release-readiness.md) R9).

## slow-queries
Check `pg_stat_statements`; search uses GIN (tsv, trigram); DIG uses `(from_entity_id, relation_type)` / credit contributor indexes. Compare with [performance-baseline](../10-testing/performance-baseline.md).

## listening-anomalies
High `rejected` share: inspect `reject_reason` distribution in `listening_event`. `played_exceeds_wall_clock` from many accounts → client bug; from a few → manipulation (exclude accounts from popularity, P1 fraud tooling).

## rate-limit-store
`RateLimitStoreFailing`: counter updates to `rate_limit_counter` fail and requests pass unlimited (ADR-0020). Check database health first: the api is usually failing too. If only the counters fail, check the table exists (migration `0011_rate_limit`) and its size (`SELECT count(*) FROM rate_limit_counter`). Expired rows are purged by the worker, so a large table means the worker is down. `UNLOGGED` tables are emptied after a crash, which only resets counters.

## payments-held
A payment, refund or App Store event could not be applied (`PaymentEventsHeld`), orders disagree with the provider (`PaymentReconcileMismatch`), or a customer pays twice (`AppStoreSubscriptionOverlap`).
1. List held events: `SELECT id, provider, type, detail, checkout_ref, received_at FROM payment_event WHERE status = 'held' ORDER BY received_at DESC`. Open the order with `GET /v1/ops/orders/{id}` (events, refunds, ledger).
2. By `detail`:
   - `amount_mismatch`, `currency`, `price`: the customer was charged a different amount; refund through the provider (web: operator refund; App Store: the customer asks Apple, support explains).
   - `unknown_account`, `unknown_checkout`, `unknown_refund`: find the account by the transaction or checkout reference; do not apply by hand without a second operator.
   - `account_deleted`: the account was deleted after paying through the App Store; the customer asks Apple for a refund. Never re-activate the account.
   - `test_over_paid`: a Sandbox purchase on an account with a real paid subscription; nothing to refund (no money moved).
3. Reconciliation mismatches are logged with the order id and kind; compare with the provider's dashboard before changing anything. Corrections are new ledger journals, never edits.
4. Overlaps: refund the newer side (see App Store below for which side can be refunded where).

## app-store
Held App Store notifications, overlapping web and App Store subscriptions, refunds and signature failures: [App Store setup and operations](app-store.md) §3.

## usage-statements
Monthly usage statements for rights holders (ADR-0025).
1. A month (Asia/Seoul) closes 3 days after it ends; `playback.close_usage_statements` runs every 6 hours and logs `usage statements closed` with the months. `GET /v1/ops/usage-statements` lists what is closed.
2. Export: `GET /v1/ops/usage-statements/{YYYY-MM}/lines?format=csv` (audited). Statements never change once closed; a correction is a new, separate document agreed with the rights holder, not an edit.
3. A month missing after its due date: check the job in `GET /v1/ops/jobs` (dead jobs show the error). Listening events of an unclosed month are never purged, so retrying the job after the fix produces the full statement.
4. Restoring a backup older than the last close: statements closed after the backup are gone; re-run the job. Months whose events were purged before the restore cannot be rebuilt — export statements to the rights holders as they close.
