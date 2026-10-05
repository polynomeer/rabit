# SLIs and SLOs

- Status: Phase 20 (2026-10-04). Targets are **proposals** (AP-13, NFR-REL/PERF) to be approved after the launch region, devices and provider are fixed. Private-data leakage and ledger mismatch are not percentage budgets: the target is zero (NFR-REL-007).
- Alert rules: [infra/observability/alerts.yml](../../infra/observability/alerts.yml). Checked on every CI run: `pnpm alerts:check` (promtool syntax check and firing tests in `alerts.test.yml`) and `alerts.test.ts` (every rule uses exported metrics and labels and links an existing runbook section). Baseline measurements: [performance-baseline](../10-testing/performance-baseline.md).

## 1. Journeys

| Journey | SLI (good / valid) | Source | 30-day SLO (proposal) |
|---|---|---|---|
| Login / any authenticated call | non-5xx responses / all `/v1` requests with a valid token | `rabit_http_request_duration_seconds_count{service="api"}` by `status_class` | 99.9 % |
| Library load | `GET /v1/library` and `/v1/playlists/:id` p95 latency | same histogram, `route` label | p95 ≤ 500 ms |
| Play start (server part) | `POST /v1/playback-sessions` non-5xx | histogram | 99.95 % and p95 ≤ 300 ms |
| Play start (client) | selection → audible frame | client telemetry (web client `ttfp` event, P1) | p95 ≤ 2 s |
| Rebuffering | stall time / play time | client telemetry (P1) | ≤ 0.5 % |
| Media delivery | media `200` / (`200` + `5xx`) | `rabit_media_requests_total` | 99.95 % |
| Upload finalize | `POST /v1/uploads/:id/finalize` non-5xx | histogram | 99.9 % |
| Transcoding latency | uploaded → ready for files ≤ 10 min | `rabit_upload_events_total` + job duration logs | p95 ≤ 5 min |
| Transcoding failure | jobs ending `dead` for non-media reasons / all processing jobs | `rabit_jobs_total{kind="audio.process",outcome="dead"}` minus permanent media failures (logs) | ≤ 0.5 % |
| Search | `GET /v1/search` p95 | histogram | ≤ 500 ms |
| DIG traversal | `GET /v1/dig/entities/:id/connections` p95 | histogram | ≤ 500 ms |
| Entitlement change → enforcement | event time → stale sessions revoked | `rabit_outbox_pending`, `rabit_job_oldest_queued_seconds`, `rabit_playback_sessions_revoked_total` | ≤ 60 s |
| Deletion | delete request → objects gone | deletion job completion | ≤ 24 h (block is immediate) |
| Purchase / entitlement (P1) | verified webhook → entitlement active | — | p95 ≤ 60 s |

Error budget for 99.9 % over 30 days ≈ 43.2 minutes. Expected denials (401/403/404 by policy) are good events; 5xx and timeouts are bad. Provider outages are not excluded but are reported separately.

## 2. Policy on budget burn

Fast burn (2 % of the monthly budget in 1 h) pages; slow burn (10 % in 6 h) creates a ticket. When the budget is exhausted, feature deploys pause until the cause is fixed (NFR-QA-005).
