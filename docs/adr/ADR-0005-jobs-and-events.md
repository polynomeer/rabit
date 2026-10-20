# ADR-0005: Postgres-backed job queue and transactional outbox

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-18 (event과 analytics)
- Related: NFR-DATA-002..005, AUD-009, CLAUDE.md (idempotent background jobs), PB §10 (no Kafka without evidence)

## Context
Processing (validate, transcode, analyze), deletion propagation, export, and search indexing are asynchronous. Delivery is at-least-once. The MVP has no evidence for streaming-platform throughput needs.

## Options
1. **PostgreSQL table queue with `FOR UPDATE SKIP LOCKED`, plus a transactional outbox table**
2. Redis-based queue (BullMQ)
3. Kafka / RabbitMQ

## Trade-offs
| Option | Pros | Cons |
|---|---|---|
| 1 | Enqueue in the same transaction as the state change (no dual write); no extra infra; easy inspection and DLQ in SQL | Throughput ceiling (thousands/s is plenty for MVP); polling |
| 2 | Fast, mature | Dual write between DB and Redis; another stateful service |
| 3 | Massive throughput, replay | Operational weight; unjustified (PB §10) |

## Decision
- `job` table: `id, kind, payload jsonb, dedupe_key UNIQUE, status (queued|running|succeeded|failed|dead), attempts, max_attempts, run_after, locked_by, locked_until, last_error, created_at, updated_at`.
- Enqueue uses `INSERT … ON CONFLICT (dedupe_key) DO NOTHING` → duplicate requests never create duplicate jobs.
- Workers claim with `SKIP LOCKED`, lease with `locked_until`; expired leases are reclaimed (crash safety).
- Retry with exponential backoff and jitter; after `max_attempts` the job moves to `dead` (DLQ). Ops API can requeue dead jobs.
- **Handlers must be idempotent**: they re-read current state and check tombstones before writing; external side effects use deterministic object keys.
- `outbox_event` table written in the same transaction as domain changes: `id, type, schema_version, subject_id, workspace_id, privacy_scope, correlation_id, occurred_at, payload jsonb, published_at`. A dispatcher fans out events to job handlers. Payloads never contain transcripts, audio, signed URLs or payment data.

## Consequences
Exactly-once is not promised; idempotency is required and tested (duplicate delivery tests).

## Amendment (2026-10-19): leases, shutdown and retention
From the architecture review:
- **Lease window and heartbeat.** A claim lasts `LEASE_WINDOW_MS` (120 s) and the worker renews it every 30 s while the job runs. A handler's `leaseMs` is its maximum runtime (it is aborted after that), no longer the claim length, so a crashed worker's job returns to the queue within about 2 minutes whatever its kind. A job whose claim was taken over is aborted.
- **Shutdown.** On SIGTERM the worker stops claiming and dispatching, gives running jobs 90 s, then hands the rest back (`queued`, the interrupted attempt not counted) and exits; the worker task's ECS `stopTimeout` is 120 s.
- **Dispatch.** The outbox dispatcher is a loop that never overlaps itself (it was a 250 ms interval).
- **Retention.** Finished jobs 14 days, dead jobs 30 days, dispatched outbox events 7 days, raw listening events after the popularity window; deleted in batches of 5,000 so no statement holds locks or the vacuum horizon for long. Popularity is one set-based statement, not one upsert per recording in a transaction.
- **Timeouts.** Application connections set `statement_timeout` (30 s) and `idle_in_transaction_session_timeout` (60 s); migrations run without them.
- **Ordering** is still per job, not per subject: handlers must stay commutative (version or tombstone checks).

## Amendment (2026-10-20): worker pools and priority
From the audio pipeline review: transcoding shared two job slots with payment events, renewals and revocations, so a catalog delivery of thousands of recordings could hold those back for hours.
- **Pools.** A handler declares `pool: 'media'` (decoding and transcoding: `audio.process`, `catalog.process`) or runs in the default `general` pool. `WORKER_POOL` selects what a worker process runs: `general` (everything else, plus the outbox dispatcher and schedules), `media`, or `all` (development and tests).
- **Priority.** Within a pool, kinds with a lower `priority` are claimed first. `catalog.process` has priority 1, so user uploads are never queued behind a catalog delivery.
- **Deployment.** The `transcoder` ECS service runs the media pool (2 vCPU, 4 GB, the worker's isolated subnets, security group and IAM role). Application Auto Scaling adds tasks while `MediaJobsReady` exceeds 4 and removes one after 15 minutes with nothing waiting (1 to 6 tasks by default). The general worker writes that metric every 30 s as an Embedded Metric Format log line.
- **Metrics.** `rabit_job_oldest_queued_seconds` and `rabit_jobs_ready` are labelled by job kind. Revocation and upload alerts exclude catalog processing; a catalog backlog older than 6 hours opens a ticket.

## Revisit trigger
Sustained queue latency above SLO at measured load; need for event replay across services; listening-event volume (moved to analytics store per AP-05).
