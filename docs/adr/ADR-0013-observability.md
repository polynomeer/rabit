# ADR-0013: Structured logs, correlation IDs, OpenTelemetry, Prometheus metrics

- Status: Accepted
- Date: 2026-10-04
- Related: NFR-OBS-001..007, PB Phase 20

## Decision
- Logs: JSON via `pino`. Every log line carries `request_id`/`correlation_id`; jobs carry `job_id` and the originating `correlation_id`; playback carries `session_id`.
- Redaction is configured centrally: `authorization`, `cookie`, tokens, signed URLs, `filename`, `title`, `note`, `transcript`, any `*_url` query strings, location fields. Account IDs are logged only as internal opaque IDs (never email).
- `X-Request-Id` is accepted only if it matches a safe pattern, otherwise regenerated; it is echoed in responses and error envelopes.
- Metrics: Prometheus text format on an internal port (`/metrics`) using `prom-client`; low-cardinality labels only (route template, status class, job kind, outcome). No user, region or track labels.
- Traces: OpenTelemetry API instrumentation hooks; exporter configuration is environment-driven (OTLP), off by default locally.

## Revisit trigger
Production observability vendor selection.
