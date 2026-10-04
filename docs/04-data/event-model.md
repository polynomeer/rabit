# Event Model

- Status: Phase 4 (2026-10-04). Transport: [ADR-0005](../adr/ADR-0005-jobs-and-events.md).

## 1. Envelope

```json
{
  "id": "evt_01J…",
  "type": "AudioReady",
  "schema_version": 1,
  "subject_id": "asr_01J…",
  "workspace_id": "wsp_01J…",
  "privacy_scope": "private",
  "correlation_id": "req_…",
  "occurred_at": "2026-10-04T01:00:00Z",
  "payload": {}
}
```

- `privacy_scope`: `private` (contains references to private data — IDs only) | `catalog` | `system`.
- Payloads carry IDs and state, never titles, notes, transcripts, filenames, audio, signed URLs, tokens, location or payment data.
- Consumers ignore unknown fields; breaking changes create a new `schema_version` and are dual-published during migration.
- Delivery: at-least-once. Consumers are idempotent by `(event id, handler)` via job `dedupe_key`.

## 2. Events (MVP)

| Event | Emitted when | Payload | Consumers (jobs) |
|---|---|---|---|
| `UploadFinalized` | UploadSession → `quarantined` | `upload_session_id, audio_source_id` | `audio.process` |
| `AudioReady` | AudioSource → `ready` | `audio_source_id, audio_version_id, origin` | `search.index_source`, `library.attach_upload` |
| `AudioProcessingFailed` | AudioSource → `failed` | `audio_source_id, failure_code` | `audio.release_quota` |
| `SourceDeletionRequested` | AudioSource → `deleting` | `audio_source_id` | `audio.delete_assets`, `search.remove_source`, `playback.revoke_for_source` |
| `SourceDeleted` | assets gone | `audio_source_id` | — (audit) |
| `RightsGrantChanged` | grant created/updated/revoked/expired | `rights_grant_id, recording_id, version, status` | `playback.revoke_stale_sessions` |
| `EntitlementChanged` | entitlement/subscription state change | `entitlement_id?, subscription_id?, user_id, version, status` | `playback.revoke_stale_sessions` |
| `ExportRequested` | export created | `export_id` | `library.build_export` |
| `AccountDeletionRequested` | user requests deletion | `user_id` | `ops.delete_account` |
| `ListeningWindowClosed` (scheduled) | periodic | `window_end` | `playback.compute_popularity` |
| `CatalogEntityChanged` | catalog metadata ingest/update | `entity_id` | `search.index_entity` |
| `ReportReceived` | report submitted | `report_id` | — (ops queue) |

## 3. Ordering and versioning

- State-bearing events carry the aggregate `version`; consumers discard events whose version is lower than what they have applied (no regression of state).
- Revocation consumers revoke sessions with `rights_version < current` / `entitlement_version < current`; reprocessing an old event is harmless.

## 4. Scheduled jobs

| Job | Period | Purpose |
|---|---|---|
| `audio.expire_upload_sessions` | 5 min | expire `created` sessions past `expires_at`, delete quarantine objects, release quota |
| `playback.expire_sessions` | 1 min | mark expired sessions |
| `catalog.expire_grants` | 5 min | `active → expired` when `valid_to` passes; emits `RightsGrantChanged` |
| `entitlement.expire` | 5 min | expire entitlements/subscriptions past validity |
| `playback.compute_popularity` | daily | recompute RecordingPopularity |
| `library.expire_exports` | hourly | delete expired export archives |
| `ops.reclaim_job_leases` | 1 min | requeue jobs with expired leases |
