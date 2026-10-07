# Privacy

- Status: Phase 7 (2026-10-04). Requirements: NFR-PRV-001..012. Legal periods are not fixed here (Legal items).

## 1. Data inventory (MVP)

| Data | Purpose | Stored where | Retention (proposal) | User controls |
|---|---|---|---|---|
| OIDC issuer + subject, email_verified flag | Account identity | `app_user` | account lifetime | delete account |
| Email, name | — | **not stored** | — | — |
| License country | Rights territory | `app_user.license_country` (operator/policy-set) | account lifetime | — |
| Private audio + derivatives | User's archive | private buckets | until deleted | delete, export |
| Audio Log title/note/tags/recorded_at/tz | User's archive | `audio_log` | until deleted | edit, delete, export |
| Blind Digging rounds and Keep/Pass decisions | Discovery history | `blind_dig`, `blind_dig_item` | until account deletion | export |
| Physical Collection (format, title, artist, barcode, catalog no., edition, notes) | Record of what the user owns (COL-001) | `physical_item` | until deleted or account deletion | edit, delete, export; support sees counts by format/state only |
| Upload declared filename | Default title | `audio_source.title` only | until deleted | edit |
| Playback sessions | Access control | `playback_session` | until their listening events are purged (90 days), then deleted | revoked on account deletion |
| Listening events | Popularity (Deep Cut), future settlement | `listening_event` | 90 days raw | deleted with the account; included in export (P1) |
| Library, playlists, DIG sessions | User features | DB | until deleted | delete, export |
| Reports | Trust | `report` | Legal | — |
| Audit log | Accountability | `audit_log` | Legal | — |
| Logs | Operations | log backend | 30–90 days (proposal) | — |
| Location | — | **not collected** | — | — |
| Transcripts / ASR | — | **not in MVP** | — | — |

## 2. Principles applied

1. **Minimization**: no email/name persisted; no location; no device fingerprinting (device_id is a client-generated random ID per install).
2. **Purpose limitation**: private audio is never used for recommendation, search outside the owner, or model training (NFR-PRV-007). Popularity uses only catalog listening.
3. **Logs**: redaction of tokens, URLs, titles, notes, filenames; IDs only.
4. **Export**: one request packages originals + JSON metadata (sources, logs, library, playlists, DIG sessions) owned by the user. Catalog masters are never exported.
5. **Deletion**:
   - Source delete: immediate access block (status `deleting` + tombstone), sessions revoked, async removal of assets, search docs, library and playlist references resolve to `deleted`.
   - Account delete: immediate block of all new access, then all owned sources, logs, playlists, library, DIG sessions, exports and listening events deleted; user row anonymized (`status=deleted`, subject replaced by a hash so the same OIDC subject can re-register as new).
   - Backups: restore procedure must re-apply tombstones/deletion list (runbook).
6. **Support**: operators see a per-user summary of counts, states and ids (subscription, storage, processing and playback health, exports, reports); every view is audited with its reason. Titles, notes, filenames, audio and listening history are not visible to support (OPS-007 approval and consent process: future).
7. **Consent**: no consent-requiring processing exists in MVP (no ASR, location, ambient noise). The consent model (NFR-PRV-004) is added with the first such feature.

## 3. Open legal items (not decided here)

Retention periods for audit/ledger/reports, data transfer abroad (Q13), minors (Q01), privacy notice text, legality of private cloud storage of third-party copyrighted audio (AP-09).
