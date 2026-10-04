# API Guidelines

- Status: Phase 6 (2026-10-04). Contract: [openapi.yaml](openapi.yaml) (source of truth, ADR-0010).

## 1. Basics
- Base path `/v1`, HTTPS, JSON UTF-8. Media bytes are served by the separate media gateway (`/media/v1/...`), not by the API (ADR-0008).
- Auth: `Authorization: Bearer <OIDC access token>` (ADR-0009). All `/v1` endpoints require auth in MVP (no anonymous catalog browsing yet — anonymous access to public metadata is P1).
- IDs are opaque prefixed strings (ADR-0015). Times are RFC 3339 UTC; local time zone is a separate IANA field.
- Field names are `snake_case`.
- Unknown request fields are rejected (`400 VALIDATION_FAILED`) so typos never silently drop data; unknown response fields must be ignored by clients.

## 2. Authorization model
- The principal is derived from the token. **Request bodies never carry `user_id`, `owner`, `workspace` ownership, role, rights, entitlement, subscription or region**; such fields are rejected.
- Resource access is checked per resource. For private resources the response for "exists but not yours" is **404** identical to "does not exist" (AP-07). 403 is used only when the caller can see the resource but lacks a capability (e.g. catalog recording without subscription), with a machine-readable reason.
- Playback, search result re-checks, playlist availability, DIG previews and exports all use the single policy in ADR-0016.
- Operator endpoints under `/v1/ops` require the `rabit:operator` role claim **and** MFA (`amr` includes `mfa`), and write an audit log entry with a mandatory `reason`.

## 3. Errors
```json
{ "error": { "code": "RIGHTS_UNAVAILABLE", "message": "This recording is not available in your region.", "request_id": "req_…", "retryable": false, "details": {} } }
```
| HTTP | When | Example codes |
|---|---|---|
| 400 | malformed / schema violation | `VALIDATION_FAILED` |
| 401 | missing/invalid token | `UNAUTHENTICATED` |
| 403 | visible resource, capability denied | `SUBSCRIPTION_REQUIRED`, `RIGHTS_UNAVAILABLE`, `PURCHASE_AVAILABLE`, `CAPABILITY_DENIED`, `FORBIDDEN` |
| 404 | not found **or** not visible | `NOT_FOUND` |
| 409 | state conflict / idempotency mismatch | `INVALID_STATE`, `IDEMPOTENCY_KEY_REUSED`, `ALREADY_EXISTS` |
| 412 | `If-Match` mismatch | `PRECONDITION_FAILED` |
| 413 | size limit | `PAYLOAD_TOO_LARGE`, `QUOTA_EXCEEDED` |
| 422 | semantically invalid | `UNSUPPORTED_MEDIA`, `CHECKSUM_MISMATCH`, `SIZE_MISMATCH`, `INVALID_RELATION_STEP` |
| 428 | `If-Match` required but missing | `PRECONDITION_REQUIRED` |
| 429 | rate limit | `RATE_LIMITED` (+ `Retry-After`) |
| 503 | dependency down | `UNAVAILABLE` (retryable) |

Messages never contain internal contract details, other users' data, storage keys or stack traces.

## 4. Pagination
`limit` 1–100 (default 20), opaque `cursor`; responses `{ "items": [...], "next_cursor": "…" | null }`. Cursors encode the sort key and ID and are signed (HMAC) so they cannot be forged to skip scope filters.

Positional, editable collections (playlist items) page by position, and their cursors are also bound to the aggregate `version`: after any edit, an older cursor returns `409 INVALID_STATE` and the client re-reads from the first page, instead of silently skipping or repeating items. An aggregate that embeds such a collection returns its first page from the same snapshot as its `version`, plus `item_count` and `items_next_cursor` (e.g. `GET /v1/playlists/{id}`; review #6).

## 5. Idempotency
- Required (`Idempotency-Key`, 8–128 chars `[A-Za-z0-9_-]`) on: upload finalize, playback session create, export create, account deletion, DIG step, ops grant/entitlement mutations.
- Stored per (user, operation) ≥ 24 h with a hash of the request body. Same key + same body → original response replayed. Same key + different body → `409 IDEMPOTENCY_KEY_REUSED`.

## 6. Concurrency
Mutable aggregates with concurrent edits (playlist, rights grant, entitlement) expose `ETag: "<version>"`. Mutations require `If-Match`; missing → 428, stale → 412.

## 7. Async operations
`202 Accepted` responses return the resource in its pending state plus a status URL. They never claim completion. Completion is observed by polling the resource.

## 8. Rate limits (MVP defaults, configuration)
| Scope | Limit |
|---|---|
| Per user, general | 600 req/min |
| Upload intents | 30/hour |
| Playback session create/refresh | 120/min |
| Listening events batch | 120/min, ≤ 100 events/batch |
| Search | 120/min |
| Reports | 20/hour |
| Exports | 5/day |
Values are proposals tuned after baseline measurement (PB Phase 22).

## 9. Uploads
1. `POST /v1/uploads` with `size_bytes`, `sha256`, intent. Server checks quota atomically, reserves bytes, chooses the key, returns a presigned PUT (≤ 15 min) bound to exact `Content-Length` and the SHA-256 checksum header.
2. Client PUTs bytes directly to storage.
3. `POST /v1/uploads/{id}/finalize` (idempotent). Server HEADs the object, verifies size and stored checksum, then moves state to `quarantined` and enqueues processing. **MIME type from the client is never trusted**; the worker sniffs and probes the bytes.
4. Arbitrary URL imports are not supported (SSRF, AUD-015).

## 10. Rights and visibility rules per resource family
| Family | Rule |
|---|---|
| audio-sources, audio-logs, uploads, exports, library, playlists, dig-sessions | owner-only; others get 404 |
| recordings, releases, artists, entities, passports, dig connections | catalog metadata visible to any authenticated user; **playability** reported per item from the policy |
| playback-sessions | policy (ADR-0016); private denials → 404 |
| search | SQL-level scope filter + canonical re-check (ADR-0006) |
| ops | operator + MFA + audit |

## 11. Versioning
Additive changes are non-breaking. Breaking changes need a new major path (`/v2`) and a human decision (Playbook §9).
