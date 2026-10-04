# Phase 24 — Independent Code Review and Dispositions

- Review: 2026-10-04, fresh-context reviewer (did not write the code), read-only, at commit `134877c`. Checks run by the reviewer: typecheck, server lint, 141 tests (all green). High and medium findings were reproduced at runtime before reporting.
- Dispositions: each finding was first **reproduced by a failing regression test** (where feasible), then fixed. Result after fixes: 150 tests, green 3 runs in a row; lint, typecheck, contract and audit green.

## Findings

| # | Sev. | Finding | Disposition | Commit | Regression test |
|---|---|---|---|---|---|
| 1 | High | Deleting a source before/during processing left its upload session holding quota and a concurrent-upload slot forever (3 deletes → permanent 429) | Fixed: deletion cancels in-flight upload sessions in the same transaction | `ca583a6` | `private-audio` "releases the quota reservation and upload slot (review #1)" |
| 2 | Medium | Listening-time budget reset per event: one batch credited 39 s in 0 s; revoked/expired sessions accepted events | Fixed: per-session cumulative budget under a row lock; inactive sessions rejected | `a9ccbb2` | `dig` "budgets played time across a whole batch…" |
| 3 | Medium | A job that crashes its worker was requeued forever (no attempts cap on lease expiry), `onDead` never ran | Fixed: lost lease counts as an attempt; exhausted → DLQ + `onDead` | `8ffbdbb` | `jobs` "dead-letters a job whose worker keeps crashing…" |
| 4 | Medium | Session refresh updated grant/entitlement versions but not ids → revoking the newly used entitlement missed the session | Fixed | `b850fee` | `library-entitlement` "tracks the entitlement actually used after a refresh…" (first attempt passed for the wrong reason — a spurious revocation masked the bug; test corrected to reproduce) |
| 5 | Medium | Race: Audio Log create/update and rename could re-write personal text after deletion | Fixed: row lock + tombstone re-check inside write transactions | `ae93fdd` | `audio-log` "deletion race guard" (guard-level; a true interleaving test needs fault injection) |
| 6 | Medium | Playlist/library reads do ~6–7 queries per item, unpaged, up to 10,000 items | Fixed: DIG trails capped at 500 steps; access policy evaluated in one batch per page (constant 12 queries); playlist items paged (first 100 embedded, `GET /v1/playlists/{id}/items`, cursors bound to the version). Measured before the fix: 1,000 items 666 ms p50 — past the recorded trigger | `6143b55` + this change | `library-entitlement` "large playlists and batched availability (review #6)" (paging, stale cursor 409, constant query count, batch = single resolution) |
| 7 | Medium | Account deletion kept listening events; no session purge; sessions not revoked | Fixed: playback deleter (revoke + delete events), daily session purge; privacy doc corrected | `29da635` | `library-entitlement` "account deletion and playback data (review #7)" |
| 8 | Low–Med | Export archive could outlive account/source deletion | Fixed: withdrawn on source deletion; a build finishing after withdrawal deletes its archive | `d691fc9` | `library-entitlement` "invalidates ready exports… (review #8)" |
| 9 | Low | DIG steps bypassed integrity exclusion | Fixed | `6143b55` | `integrity-ops` "honours a reviewed exclusion" (step → 422) |
| 10 | Low | Idempotency key stuck "in progress" for 2 days after a crash | Fixed: reservations without a response older than 10 min are reclaimable | `076021c` | `idempotency-cursor` "reclaims a reservation abandoned…" |
| 11 | Low | Catalog ingest enqueued after commit; recording duration could be lost on retry | Fixed: upload before tx, enqueue inside tx; duration in the `ready` transaction | `b6ff183` | covered by catalog tests (duration asserted) |
| 12 | Low | License-country change did not revoke sessions | Fixed: `LicenseCountryChanged` event → revoke user sessions | `29da635` | `library-entitlement` "license territory changes (review #12)" |
| 13 | Low | Test gaps behind #1–#5 | Fixed: tests listed above | — | — |
| 14 | Low | `catalog:ingest` script pointed to an untracked file; root lint failed on untracked web app | Already resolved: both committed in `248eaf7` before the dispositions | `248eaf7` | lint green |
| 15 | Low | Threat model T19 claimed protections not in code | Fixed: T19 rewritten to what is enforced | `a9ccbb2` | — |

## Areas the reviewer verified with no issue
Private-source isolation on every path (sources, uploads, logs, playlists, library, DIG, search, exports, playback, listening), media gateway (path allow-list, signed namespace, timing-safe HMAC, per-request session/source check), auth on all routes (operator role + MFA, dev issuer refused in production, deletion-pending accounts blocked), no client-supplied ownership/territory/entitlement, upload quota locking and presign binding, media inspection hardening, job/outbox semantics, playlist concurrency, rights/entitlement versioning, signed cursors, log redaction, API contract parity.

## Found while closing #6: clock mixing
Investigating two intermittent test failures showed that the app clock and the database clock were compared with each other:
- Job due times were written on the app clock but claimed against `now()`. A host clock even slightly ahead of the database made a fresh job "not yet due", so `drain()` returned without running it. Fixed in `d86e83a`, with a skew test in `jobs`.
- The listening budget subtracted the database-default `issued_at` from the API host's `Date.now()`. Fixed in `d4da94e` (budget on `now()`), with a skew test in `dig`.

Still mixed, but tolerable: time limits that have a large margin compared with normal (NTP) skew. Entitlement and grant `valid_from` default to `now()` and are compared with the app clock, so a grant can become valid a few milliseconds late. Session expiry is set and checked on the app clock and has a 60 s grace period. Rule for new code: compare a timestamp only with one written on the same clock. Prefer the database `now()` when the value is written by a database default.

## Remaining follow-ups
- True interleaving test for #5 (fault-injection hook in the delete job).
