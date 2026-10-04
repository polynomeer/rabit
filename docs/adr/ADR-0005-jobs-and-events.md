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

## Revisit trigger
Sustained queue latency above SLO at measured load; need for event replay across services; listening-event volume (moved to analytics store per AP-05).
