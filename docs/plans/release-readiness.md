# Release Readiness Audit

- Status: Phase 23 (2026-10-04), audit of `main` at the end of the build track. Written without code changes. Independent code review: [phase-24-code-review](phase-24-code-review.md).
- Classification: **Blocker** (must be resolved before the named release), **Must fix** (before the release, smaller), **Follow-up** (tracked, not blocking).
- Two release targets are assessed separately, because the MVP was cut as an internal alpha behind the Commercial Gate (mvp-scope §0.3):
  - **A. Internal alpha** — invited team members, self-made fixture catalog, no payments.
  - **B. External launch** — real users, real catalog.

## Verdict

| Target | Verdict |
|---|---|
| A. Internal alpha | **Not yet release-ready.** Code-level gates pass (141 tests, lint, typecheck, contract, audit), but hosting, backup/restore drill and the Phase 24 findings must be closed first (see A-blockers). |
| B. External launch | **Not release-ready.** Blocked by human decisions (catalog contracts, legal review, payments, privacy notice, retention, staffing) in addition to everything in A. |

## Findings

| # | Area | Finding | Evidence | A | B |
|---|---|---|---|---|---|
| R1 | Requirements coverage | All P0 server requirements in mvp-scope §0.6 are implemented and tested. **Update (same day):** the web reference client now covers PLY-002 ownership display, a persistent player, LIB-001 Archive, DIG-026 (list-first graph); verified manually in a browser (search → play → DIG trail; listening events accepted; no horizontal scroll at 375 px). **Update:** automated browser E2E added (`apps/web/e2e`, CI job `e2e`; 4 scenarios, 20/20 green in repeated runs) | test-strategy §1; `apps/web` | OK | OK (extend per feature) |
| R2 | Migrations / rollback | 10 reversible migrations; full down/up tested on every run; expand/contract policy documented; no destructive migration exists | `migrations.test.ts`, erd §5 | OK | OK |
| R3 | Security P0 | Threat-model P0 tests exist and pass (T01–T17, T24–T30); production worker sandbox is process-level only (ADR-0007 Proposed) | threat-model §2–4 | **Blocker** (sandbox before any non-team user) | Blocker |
| R4 | Security P1 | Artist impersonation, public UGC abuse, payment webhook replay not applicable yet (features absent) | threat-model T18–T23 | Follow-up | Blocker when features ship |
| R5 | Rights / legal gates | Catalog content is fixtures only; G-CAT, G-SALE, G-UGC, G-LOCKER, G-CD, G-DATA all open | rights-model §4 | OK (fixtures only) | **Blocker** |
| R6 | Privacy | No email/name/location stored; logs redacted; export and deletion implemented; privacy notice, retention periods (Legal), minors (Q01) undecided | privacy.md | Must fix (internal notice to testers) | Blocker |
| R7 | API compatibility | Contract test passes both directions; `/v1` only; no breaking change policy violations | `contract.test.ts` | OK | OK |
| R8 | SLO / alerts | SLIs/SLOs proposed, alert rules written but not deployed; client-side SLIs (TTFP, rebuffer) need a client | slo.md, alerts.yml | Must fix (deploy alerts) | Blocker |
| R9 | Backup / restore | Restore procedure documented (re-apply tombstones) but no drill performed; RPO/RTO unverified. **Update 2026-10-05:** local drill (`drill:restore`) found that a restore brought back audio removed after the backup (the audit log is restored too, so the old procedure could not see it); `restore:reconcile` now re-applies deletions from missing objects and in-flight tombstones, and the drill passes (2 sources, ~0.8 s restore+reconcile on a laptop). Still open: a drill on the real hosting with production-size data and backup schedule (RPO/RTO), and accounts deleted after a backup (reported for manual check only) | runbooks#backup-restore; `restore-reconcile.test.ts` | **Blocker** (hosted drill, needs R19) | Blocker |
| R10 | Object lifecycle | Quarantine/exports lifecycle (2 d) + expiry jobs; deletion sweeps prefixes. **Update 2026-10-05:** catalog audio removal API for operators (refused while a grant is in force or suspended, audited); mandatory removal and retention periods are Legal (RQ-01) | audio-pipeline §5; `library-entitlement` "catalog audio removal (R10)" | OK | OK (policy: RQ-01) |
| R11 | Moderation / takedown | Reports + triage + grant suspension implemented; uploader notification, appeals, counter-notice absent; staffing Q18 | moderation.md | Follow-up | Blocker |
| R12 | Feature flags | No feature-flag system; all P0 features always on; P2 features absent rather than flagged | — | OK | Follow-up |
| R13 | Rate limits | Per-user and per-route limits on. **Update 2026-10-05:** counters shared in Postgres for every api instance (ADR-0020); fail-open on store failure, with a metric and an alert | `rate-limit.test.ts` (two instances share one limit) | OK | OK (re-measure overhead on staging) |
| R14 | Secrets | Validated at startup, never logged; `.env.example` has dev-only values; production secret store undecided (ADR-0012) | config.ts | Must fix (secret store for hosted alpha) | Must fix |
| R15 | Dependency vulnerabilities | `pnpm audit --prod`: no known vulnerabilities (2026-10-04); Dependabot configured | CI `security` job | OK | OK |
| R16 | Load test | Baseline measured on one laptop; media gateway not load-tested; no staging environment | performance-baseline.md | Follow-up | Blocker |
| R17 | Runbooks | Written for the main failure modes; not rehearsed | runbooks.md | Must fix (one game day) | Blocker |
| R18 | Support / admin tooling | Operator API (rights, entitlements, subscriptions, license country, jobs, reports, integrity, catalog audio removal). **Update 2026-10-05:** support summary per user (`GET /v1/ops/users/{id}/support-summary`, reason + audit, metadata only); users see their support ID in Account. Web operator console (support, reports, jobs, rights and audio removal; reason on every action) | `integrity-ops` "support summary (R18)"; E2E `ops.spec.ts` | OK | OK (private-content support access needs the OPS-007 process) |
| R19 | Hosting | Cloud provider, CDN, KMS, region undecided (ADR-0004/0008/0012 Proposed) | ADR index | **Blocker** (for any hosted alpha) | Blocker |
| R20 | Codec ladder | Single provisional AAC 160 kbps rendition; no listening test | ADR-0008 | Follow-up | Must fix |
| R21 | Payments / ledger | Not implemented (ADR-0018 Proposed) | — | OK | Blocker |
| R22 | CI | Workflow written but never executed on GitHub (remote has no pushed history) | `.github/workflows/ci.yml` | Must fix (first green run) | Must fix |
| R23 | Phase 24 code review | 1 High + 6 Medium + 8 Low findings; all reproduced and fixed (#6 completed after the audit: batched policy + paged playlist items). See [phase-24-code-review](phase-24-code-review.md) | tests green ×3 | OK | OK |

## A-blockers summary (internal alpha)
R3 production worker isolation, R9 backup/restore drill, R19 hosting decision, plus any Blocker/High from Phase 24. R19 and the sandbox design depend on a human decision (cost/provider, Playbook §9).

## Human decisions needed (not resolvable by engineering)
Q01, Q02, Q04, Q05, Q07, Q08, Q11, Q12, Q13, Q18; hosting/CDN/KMS provider; legal review of private storage of third-party audio; privacy notice and retention periods; codec ladder approval after listening tests.
