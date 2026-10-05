# Test Strategy

- Status: Phase 21 (2026-10-04). Gates: [quality-gates](quality-gates.md). Test code: `apps/server/test/`.
- Principles: tests run against **real Postgres and S3 (SeaweedFS; MinIO until 2026-10-05)** and real ffmpeg (no mocks of the database, storage or decoder); audio fixtures are generated with ffmpeg (CAT-008); a flaky test is a defect, never an accepted state (NFR-QA-003).

## 1. Layers

| Layer | What | Where | Status |
|---|---|---|---|
| Unit | IDs, config validation, cursor/idempotency codecs, backoff, popularity tiers | `test/platform/*` | ✅ |
| Domain invariant | State machines (upload, source, grant, entitlement, report), quota reservation, ledger (P1) | module integration tests + DB `CHECK` constraints | ✅ (ledger P1) |
| Repository integration | Kysely queries on Postgres, migrations up → down → up on a scratch DB | `migrations.test.ts`, all module tests | ✅ |
| API contract | Every route ↔ OpenAPI operation; main responses validated against schemas | `contract.test.ts` | ✅ |
| Authorization | Cross-user 404 matrix, operator/MFA gates, forged claims | `private-audio`, `library-entitlement`, `search`, `dig`, `integrity-ops` | ✅ |
| Media pipeline | Sniffing, probe limits, malformed inputs, HLS output, loudness, waveform | `private-audio.test.ts` | ✅ |
| Queue / retry | Dedupe, SKIP LOCKED claims, backoff, DLQ, lease reclaim, outbox fan-out, operator retry | `jobs.test.ts`, `integrity-ops.test.ts` | ✅ |
| Migration | Full rollback and re-apply | `migrations.test.ts` + global setup on every run | ✅ |
| End-to-end (browser) | Real Chromium against an isolated stack (api, worker, media, web; database `rabit_e2e` recreated per run; demo catalog). Scenarios: search → play → DIG with playback continuing → trail to playlist; upload → play → private to others → delete; playlist paging and stale cursor; recording/release/artist pages with Music Passport, reports and deep links; Audio Log editing, waveform, library removal and upload cancel; DIG sessions that survive reloads, point marks, ending and history, and quick successive actions that never show an older state; Account subscription and entitlements with their origin; 375 px layout | `apps/web/e2e/` (`pnpm e2e`, CI job `e2e`) | ✅ |
| Load | Measured baseline with autocannon | `apps/server/bench/` + [performance-baseline](performance-baseline.md) | ✅ baseline |
| Chaos / failure | Transient storage outage → retry/DLQ/operator retry; delete during processing; crashed worker lease | `private-audio`, `integrity-ops`, `jobs` | ✅ partial (DB failover, CDN invalidation: P1, need staging) |
| Security regression | Threat-model P0 tests (below) | all | ✅ |
| Architecture | Module boundaries, no console logging, platform ↛ modules | `architecture.test.ts` | ✅ |

### Running the browser E2E tests
`pnpm infra:up`, then `pnpm e2e`. Playwright starts `apps/web/e2e/stack.ts`: it recreates `rabit_e2e`, migrates, ingests the demo catalog, and starts the four processes on ports 18080/18081/15173 (dev servers can keep running). It reports ready only when catalog processing and all event consumers are done. Logs go to `apps/web/e2e-results/stack.log`; traces and screenshots of failures go to `apps/web/e2e-results/artifacts/`.

Defects the first runs found (all fixed, each with a regression test or an E2E assertion):
- The Archive upload form overflowed a 375 px screen (file input width).
- DIG kept a stale axis after a quick click (out-of-order responses).
- An upload was missing from the Archive right after processing (the library entry is created asynchronously).
- A territory change revoked sessions started after the change.
- Tests set job due times from the app clock.

## 2. Required negative tests (PB Phase 21)

| Case | Test |
|---|---|
| Another user's private audio | `private-audio` "returns 404 for every way of reaching another user's source", "never lists…"; `search` "never returns another user's private audio", canary for corrupted index; `library-entitlement` "never lets another user save or see…", playlist cross-user; `dig` "starts from own audio … foreign 404"; `audio-log` "hides other users' logs" |
| Entitlement forgery | `library-entitlement` "rejects client-supplied entitlement, region or subscription claims", "allows ops endpoints only for operators", "requires MFA" |
| Expired URL | `private-audio` "rejects expired, tampered and foreign-secret tokens", "rejects requests after the session expires"; storage "accepts a presigned PUT only with the exact bytes" |
| Malformed media | `private-audio` malformed media suite (random, text, fake RIFF, video-only, over duration cap) |
| Duplicate webhook / job | `jobs` dedupe and outbox idempotency; `private-audio` duplicate finalize, reprocessing a ready source; `dig` duplicate listening events. Payment webhooks: P1 (ADR-0018) |
| Concurrent playlist edit | `library-entitlement` "requires If-Match and rejects stale versions" (parallel adds → 201 + 412) |
| Rights withdrawal | `library-entitlement` "blocks new sessions immediately and revokes active sessions", grant expiry |
| Deleted / unavailable catalog item | `library-entitlement` playlist availability (`deleted`, `subscription_required`), `no_audio` playability |
| Region privacy threshold | Not applicable until Music Atlas is built (P2); test cases are specified in [music-atlas §3.1](../03-architecture/music-atlas.md) |

## 3. Threat-model P0 coverage
T01–T17, T24–T30 have tests named in the [threat model](../06-security/threat-model.md); T18–T23 are P1 (public UGC, payments). Absence-based mitigations (T24 no location columns, T28 no URL import, T30 no operator read path) are verified by schema/route review in the contract test (no such routes exist).

## 4. Running
```bash
pnpm infra:up
pnpm test            # all suites, sequential files, ~20 s
```
Determinism rules: each test creates its own users and catalogs; assertions never depend on rows created by other files (e.g. popularity percentiles are asserted only for order-independent facts); injected failures are scoped to the test's own object keys.
