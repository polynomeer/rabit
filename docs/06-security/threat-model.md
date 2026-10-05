# Threat Model (STRIDE)

- Status: Phase 7 (2026-10-04). Scope: MVP P0 system ([system-context](../03-architecture/system-context.md)).
- Priority: **P0** = must be mitigated and tested before the internal alpha; P1 = before public launch; P2 = later.
- "Test" names the automated test (or drill) that proves the mitigation; the implementation gate fails if a P0 test is missing.

## 1. Assets

| Asset | Sensitivity |
|---|---|
| Private audio originals, derivatives, waveforms | High (personal voice, unreleased work) |
| Audio Log metadata (title, note, time, tags) | High |
| Existence of a private object | High (side channel) |
| Catalog masters and HLS | High (licensed content; contract obligations) |
| Entitlements, subscriptions, rights grants | High (money/rights integrity) |
| Tokens (OIDC access tokens, media tokens, presigned URLs, cursors) | High |
| Listening events | Medium (behavioural data; future settlement input) |
| Audit log | High (integrity) |
| DIG sessions/trails | Medium (behavioural) |

## 2. Threats

| ID | STRIDE | Threat | Attacker / path | Impact | Mitigation | Detection | Pri | Test |
|---|---|---|---|---|---|---|---|---|
| T01 | S | Credential/session theft (stolen bearer token) | Malware, XSS in client, log leak | Account takeover, private audio exfiltration | Short-lived OIDC tokens; tokens never logged (redaction); CSP on web client; MFA for operators; no token in URLs (media uses separate short media token) | Auth failures metric; anomaly of sessions per user | P0 | `auth.test`: expired/invalid/wrong-aud tokens rejected; log redaction test |
| T02 | S | Forged JWT / algorithm confusion | Attacker crafts token | Full impersonation | JWKS only, allow-list `RS256/ES256`, reject `none`/HS*, check `iss`,`aud`,`exp`,`nbf` | 401 rate | P0 | `auth.test` |
| T03 | S/E | Dev issuer left enabled in production | Misconfiguration | Anyone mints tokens | Startup refuses `NODE_ENV=production` with dev issuer enabled | Startup failure | P0 | `config.test` |
| T04 | I/E | **IDOR**: access another user's source/log/playlist/export/dig session by ID | Authenticated user enumerates IDs | Private data leak | Every query scoped by principal's workspace/user; 404 for not-yours; IDs are not secrets but are unguessable anyway | 404 rate per user; canary objects | P0 | `idor.test` cross-user matrix over every resource endpoint |
| T05 | I | **Private audio leakage via search / DIG / playlists / library** | User searches for others' titles; adds others' source IDs to playlist; starts DIG from others' source | Existence and title leak | SQL-level scope filter + canonical re-check; playlist add validates access; DIG start validates access | canary search test | P0 | `search-acl.test`, `playlist.test`, `dig.test` |
| T06 | I | Existence side channel via identical hash / dedup | Upload same file and observe behaviour | Learn that another user owns a file | No cross-account dedup (ADR-0014); responses identical regardless | — | P0 | `upload.test` same-hash two users |
| T07 | I/E | **Signed URL / media token replay or sharing** | User shares manifest URL | Unlicensed redistribution, private leak | Media token ≤ 60 s, HMAC bound to session + asset prefix; session state checked per request; tokens not reusable across sessions; presigned upload URLs single key, exact size, 15 min | Token rejects metric | P0 | `media.test` expired token, revoked session, path traversal, wrong session prefix |
| T08 | T/E | Path traversal in media gateway | `../` in path | Read arbitrary bucket objects | Path segment allow-list `^[A-Za-z0-9_.-]+$`, no `..`, key = token prefix + segment | — | P0 | `media.test` |
| T09 | D/E | **Malicious media** (decoder exploit, zip bomb, huge duration, many streams) | Uploader | RCE in worker, resource exhaustion | Magic-byte sniffing allow-list; ffprobe with timeout; reject >1 audio stream / video-only / attachments; duration/size caps; ffmpeg protocol whitelist file only; per-job wall clock + output size cap; worker isolated process (prod sandbox Proposed, ADR-0007) | Job failure codes metric; DLQ | P0 | `processing.test` malformed fixtures (truncated, random bytes, video, text-renamed, oversized duration) |
| T10 | D | **Oversized upload** | Client lies about size or uploads more | Storage cost, quota bypass | Presigned PUT bound to exact `Content-Length`; finalize verifies HEAD size + checksum; quota reserved atomically at intent; per-file and total caps | quota metric | P0 | `upload.test` size mismatch, quota race (parallel intents) |
| T11 | T | **Metadata injection** (XSS in titles/notes, log injection, prompt injection) | Uploader / any user writing text | Script exec in other clients (later public), log forging | Output encoding in clients; JSON logs (no line injection); text fields length-limited and stored raw; never interpreted as instructions; no HTML rendering | — | P0 | validation tests; web client renders text only |
| T12 | T/R | **Entitlement tampering** (client claims subscription/entitlement/region) | Client sends fields | Free access to catalog | Request schemas reject unknown fields; entitlement/region are server-side only; ops changes need operator role + MFA + audit | audit log | P0 | `entitlement.test` forged body fields rejected; non-operator ops → 403 |
| T13 | E | Operator privilege abuse / non-operator calling ops API | Insider / user | Grant free access, revoke others | Role claim + MFA; mandatory reason; append-only audit log (DB privileges) | audit review | P0 | `ops.test` |
| T14 | T | **Rights withdrawal not enforced** | Contract ends; sessions continue | Contract breach | Policy at access time; revocation job revokes sessions with stale versions; media token ≤ 60 s; refresh re-checks | revocation lag metric | P0 | `rights-revocation.test` |
| T15 | T | **Duplicate jobs** / duplicate finalize | Retry storms, at-least-once delivery | Double processing, double quota | `dedupe_key` unique; idempotency keys on finalize; handlers idempotent; tombstone checks | duplicate counter | P0 | `jobs.test`, `upload.test` duplicate finalize |
| T16 | T | Deleted content resurrected by late job | Race between delete and processing | Private data reappears | Tombstone checked at job start and before each write; assets written under source prefix deleted by deletion job; deletion job re-runs if processing completes after it | — | P0 | `deletion.test` delete during processing |
| T17 | I | Data leak in logs/metrics/events | Developers, log processors | PII exposure | Central redaction; events carry IDs only; no high-cardinality labels | log scan test | P0 | `logging.test` |
| T18 | S | **Artist impersonation** | User names their upload as a famous artist | Fraud, confusion | MVP: user uploads are private only; no public artist claim; catalog entities only from ingest | reports | P1 (public UGC) | — |
| T19 | R/T | **Stream fraud** (bot plays to inflate popularity) | Bots | Distorted Deep Cut tiers, future royalties | Events accepted only for the caller's own active session (≤ 60 s grace after expiry, never after revocation); the session's **total** accepted played time is bounded by wall-clock time since issue + 5 s, enforced under a row lock across batches; duplicates ignored; popularity counts *distinct listeners* (one per user per recording per window), so repeat plays by one account do not raise it; popularity not used for settlement in MVP. Per-day contribution caps belong to Atlas (P2) | rejected-event metrics, `ListeningEventRejectionsSpike` alert | P1 (P0 for the session budget) | `dig.test.ts` listening-event tests incl. batch budget (review #2) |
| T20 | — | **Copyright abuse** via private uploads (hosting pirated catalog) | Uploader | Legal exposure | Private only, no sharing, no public links in MVP; legal review of private cloud storage pending (Legal); takedown workflow documented | reports | P1 | — |
| T21 | D/R | **Takedown abuse** (false reports to suppress content) | Competitor | Wrongful removal | Reports never auto-remove; triage + evidence + appeal (P1 workflow) | report volume per reporter | P1 | `reports.test` (rate limit) |
| T22 | — | **AI spam** floods | Uploaders | Discovery pollution | No public UGC in MVP; integrity axes model ready; upload rate limits | upload rate metrics | P1 | — |
| T23 | S/T | **Webhook replay** (payment) | Attacker replays provider webhook | Free entitlements | No payment webhooks in MVP (ADR-0018). P1 design: signature + timestamp window + unique event_id | — | P1 | — |
| T24 | I | **Location privacy** | Server correlates region and identity | Tracking | No location collected in MVP (LOC-003); no location fields in schema | schema review | P0 (absence) | `schema.test` no location columns |
| T25 | D | Request flooding / expensive queries | Any user | Outage | Rate limits per user and route, shared by every api instance (ADR-0020; fail-open on store failure, alerted); query limits; search `q` ≤ 200; DIG depth/limit caps; body size limits | 429 metric | P0 | `ratelimit.test` |
| T26 | T | Cursor tampering to bypass scope | Modify cursor | Leak other pages/scopes | Cursors HMAC-signed and bound to user + query | — | P0 | `pagination.test` |
| T27 | I | Export link leak | Shared download URL | Private data leak | Export URL presigned ≤ 15 min, export object deleted after 24 h; only owner's own data included | — | P0 | `export.test` only own data |
| T28 | E | SSRF via URL import | Attacker supplies URL | Internal network access | No URL import (AUD-015); worker has no URL inputs | — | P0 | n/a (absence) |
| T29 | T | DIG trail fabrication (client claims edges that don't exist) | User | Fake public trails later | Server verifies the relation/credit connects parent→child | — | P0 | `dig.test` |
| T30 | I | Operator reading private audio | Insider | Privacy breach | No operator endpoint reads private content. The support summary (R18) returns counts, states and ids only and audits each view with its reason. Access to private audio for support requires a future approved process (OPS-007) | audit | P0 (absence) | `integrity-ops` "support summary" (canary: private filename, Audio Log title/note and playlist title never appear) |

## 3. P0 gate

All P0 rows must have their tests passing in CI before the implementation is considered complete (Phase 11–16 DoD). The mapping is re-checked in the release readiness audit (Phase 23).

## 4. Accepted residual risks (MVP, internal alpha)

| Risk | Why accepted now | Owner / revisit |
|---|---|---|
| Worker isolation is process-level only locally | Production sandbox depends on hosting (ADR-0012, Proposed) | Before any external user |
| No DRM; bytes in buffer/downloaded segments cannot be recalled | Contract-dependent (ADR-0008) | Commercial Gate |
| Private cloud storage legality not reviewed | Legal item (AP-09) | Before public launch |
