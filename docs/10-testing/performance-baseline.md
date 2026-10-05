# Performance Baseline

- Status: Phase 22, measured 2026-10-04 on a developer laptop (10 CPU cores, Node 23, Postgres 16 and MinIO in Docker on the same machine; object storage has since moved to SeaweedFS, so re-measure before comparing). Reproduce: build, start the three roles with `RATE_LIMIT_ENABLED=false` on the api, then `pnpm --filter @rabit/server bench` (script: `apps/server/bench/baseline.ts`).
- These are **measurements on one machine with a small dataset**, not capacity claims. No 10k/100k/1M-user numbers below are measured; the sizing section is arithmetic from assumptions.

## 1. Method
- autocannon, 20 connections, 10 s per endpoint, one authenticated user, api log level `info` (realistic logging cost).
- The script fails if any request is non-2xx. The first run measured mostly `429` responses (per-user rate limit 600/min) and was discarded; `RATE_LIMIT_ENABLED=false` (refused in production by config validation) was added for benchmarks.
- Dataset: ~160 catalog entities, ~20 audio sources, 50 recordings on one album, playlist with 13 mixed items.

## 2. API latency (server side, 20 concurrent)

| Endpoint | req/s | p50 ms | p90 ms | p97.5 ms | p99 ms |
|---|---|---|---|---|---|
| `GET /v1/me` | 1,864 | 10 | 13 | 16 | 18 |
| `GET /v1/library` | 841 | 22 | 28 | 32 | 36 |
| `GET /v1/playlists/:id` (13 mixed items) | 193 | 100 | 114 | 135 | 142 |
| `GET /v1/search` | 1,032 | 18 | 23 | 28 | 35 |
| `GET /v1/dig/.../connections` (credits, 50 results) | 124 | 155 | 180 | 214 | 229 |
| `GET /v1/dig/.../axes` (recording, 14 axes) | 204 | 92 | 114 | 126 | 136 |
| `POST /v1/playback-sessions` (catalog, full policy) | 1,233 | 15 | 20 | 24 | 28 |

All are within the proposed SLOs (p95 ≤ 500 ms; playback session p95 ≤ 300 ms) at this concurrency.

Media gateway (R16): the script also loads `GET` on the HLS manifest and on one segment through the media role (token check, session check and object read per request). A first run on SeaweedFS (2026-10-05) returned only 2xx under 20 concurrent connections, but the machine was saturated by other workloads (load average ≈ 40 on 10 cores; every API number was 5–7× worse than the table above), so its latencies are **not recorded**. Re-measure all rows, including media, on an idle machine or on staging.

Single-request scaling of playlist reads (median of 10): 10 items 6.9 ms, 50 items 17.6 ms, 100 items 30.2 ms → ~0.3 ms per item, linear.

## 3. Processing and storage

| Measure | Value |
|---|---|
| Transcoding throughput (worker concurrency 2) | 3 × 60 s WAV + 3 × 30 s catalog WAV ready in 19.8 s wall clock ≈ **13.6 s of audio per second** |
| Upload intent + presigned PUT + finalize (3 × 10.6 MB, parallel) | 0.3 s |
| Storage per minute of 44.1 kHz stereo 16-bit WAV | original 10.6 MB, HLS (AAC 160 kbps provisional) 1.22 MB, waveform 120 B |

Storage growth is dominated by originals (≈ 90 %); derivatives add ≈ 11.5 % for WAV input (less, relatively, for compressed input).

## 4. Query plans (EXPLAIN ANALYZE)

| Query | Time | Plan |
|---|---|---|
| Search `tsv @@ websearch_to_tsquery` | 0.05 ms | Seq scan at 171 docs (planner prefers it at this size; GIN index exists) |
| Credits by contributor + role | 0.04 ms | Index scan |
| Active grant for recording | 0.05 ms | Index scan |

## 5. Costliest paths and decisions

| Path | Cause | Decision | Revisit trigger |
|---|---|---|---|
| Playlist/library reads | Access policy was evaluated per item (6 queries per item) — availability must still be re-evaluated on every read | **Done (review #6, 2026-10-04):** policy evaluated per page in one batch (`evaluatePolicies`, `resolveRefs`), playlist items paged (100 per page, version-bound cursors). Measured locally, `GET /v1/playlists/:id`: 1,000 items 6,003 → 12 queries, p50 666 → 13 ms; 10,000 items 60,003 → 12 queries, p50 6.4 s → 13 ms. A test asserts the query count does not grow with playlist size | p95 > 300 ms |
| DIG connections | Playability was computed per recording result | **Done (2026-10-04):** one batch per page (`playabilities`); a test asserts page size does not change the query count | p95 > 300 ms |
| Release detail | Track playability was evaluated per track | **Done (2026-10-05):** one batch per release (`playabilities`); a test asserts 2 and 4 tracks cost the same queries | p95 > 300 ms |
| DIG axes | Every axis computes its full connection list to count it | Replace with COUNT queries per axis | p95 > 300 ms or entities with > 500 connections |
| Media gateway | One DB check per segment request | Keep (it enables immediate revocation); add a ≤ 2 s in-process session cache if DB load requires | media p95 > 50 ms or DB CPU from media > 30 % |

## 6. Sizing arithmetic (assumptions, not measurements)

Assumption A04 (AP-15): 10,000 MAU, 1,000 peak concurrent listeners, 160 kbps provisional AAC.
- Egress ≈ 1,000 × 160 kbps = **160 Mbit/s** at peak, ≈ 72 MB per listener-hour.
- Media requests: 4 s segments → 250 segment requests/s at peak, each with one indexed DB lookup — far below the measured api throughput, but the media role must be load-tested separately before launch.
- Uploads: at 13.6 audio-seconds/s per 2-worker process, one worker process handles ≈ 49 hours of uploaded audio per hour.
- Storage: 1 hour of uploaded WAV ≈ 0.7 GB (original + derivatives); free-tier quotas (Q03) drive storage cost more than catalog size.

100k/1M users are not estimated here: they depend on CDN choice, codec ladder and region (ADR-0008/0012).
