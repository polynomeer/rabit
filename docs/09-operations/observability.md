# Observability

- Status: Phase 20 (2026-10-04). Decision: [ADR-0013](../adr/ADR-0013-observability.md).

## 1. Correlation
- Every API request has `request_id` (accepted from `X-Request-Id` only if it matches `^[A-Za-z0-9_-]{8,64}$`, else generated) returned in the header and in error envelopes.
- Domain events carry `correlation_id` = originating request id; jobs created from them carry it too, so a request → outbox → job → log chain is searchable by one id.
- Playback: `session_id` links session issue, media requests (logged by route with outcome only) and listening events.

## 2. Metrics (implemented)

| Metric | Labels | Purpose |
|---|---|---|
| `rabit_http_request_duration_seconds` | service, method, route (template), status_class | Availability and latency SLIs |
| `rabit_jobs_total` | kind, outcome | Processing success/retry/dead |
| `rabit_jobs`, `rabit_job_oldest_queued_seconds`, `rabit_outbox_pending` | status | Backlog and enforcement lag |
| `rabit_playback_decisions_total` | origin, decision | Denial reasons (rights vs subscription vs not found) |
| `rabit_media_requests_total` | kind, outcome | Data-plane errors, bad tokens, revoked sessions |
| `rabit_upload_events_total` | event | Upload funnel |
| `rabit_listening_events_total` | outcome | Fraud and client bugs |
| `rabit_playback_sessions_revoked_total` | reason | Rights/entitlement enforcement |

No user, track, region or file labels (cardinality and privacy). Endpoints: api `:9464`, worker `:9465`, media `:9466` — internal network only.

## 3. Logging policy (PII and audio metadata)

| Never logged | Logged instead |
|---|---|
| Authorization headers, tokens, media tokens, presigned/manifest/download URLs | request id, route template |
| File names, titles, notes, transcripts, tags | entity ids |
| Email, names, IP-derived location, GPS | internal user id only when needed |
| Request bodies | validation issue paths (never values) |
| Payment data (P1) | provider event id |

Enforced by central redaction in `platform/logger.ts`; request serializers log route templates, not raw URLs (which may carry tokens or cursors).

## 4. Tracing
OpenTelemetry instrumentation hooks are reserved; exporter configuration (OTLP) is environment-driven and off locally. The correlation id already allows log-based tracing across api → worker.
