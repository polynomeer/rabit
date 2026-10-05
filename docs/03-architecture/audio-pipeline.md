# Audio Pipeline

- Status: Phase 9 (2026-10-04). Decisions: ADR-0004 (storage), ADR-0005 (jobs), ADR-0007 (transcoding), ADR-0008 (delivery), ADR-0014 (no dedup).

## 1. Stages

```mermaid
flowchart LR
    I[ingest: upload intent] --> Q[quarantine: presigned PUT]
    Q --> F[finalize: HEAD size + checksum]
    F --> V[validate: sniff + probe]
    V --> T[transcode: HLS AAC provisional]
    T --> A[analyze: loudness, waveform]
    A --> S[store: original → private-originals, derivatives → private-media]
    S --> P[publish: source ready, search index, library]
    P --> ST[stream: playback session → media gateway]
```

Catalog ingest uses the same validate/transcode/analyze steps with catalog buckets and the catalog workspace, triggered by the ingest CLI.

## 2. Step details

| Step | Input | Checks / actions | Output | Failure code |
|---|---|---|---|---|
| Intent | `size_bytes`, `sha256`, intent | quota (atomic reservation), `size ≤ max_file_bytes`, concurrent upload cap, user active | UploadSession `created`, presigned PUT (15 min, exact length, `x-amz-checksum-sha256`) | `QUOTA_EXCEEDED`, `PAYLOAD_TOO_LARGE` |
| Upload | bytes | storage enforces length and checksum | object in `rabit-quarantine` | — |
| Finalize | Idempotency-Key | state `created`, not expired; HEAD object size == declared; stored checksum == declared | state `quarantined`; AudioObject/Version/Source(`processing`) created; job `audio.process` | `SIZE_MISMATCH`, `CHECKSUM_MISMATCH`, `UPLOAD_MISSING` |
| Validate | quarantine object | download to temp; recompute SHA-256 (must equal); magic bytes ∈ {WAV/RIFF, FLAC, MP3 (ID3/frame sync), OGG, M4A/MP4 `ftyp`, AIFF}; ffprobe (timeout 30 s): exactly ≥1 audio stream, no video except attached cover art ignored, codec ∈ allow-list, `0 < duration ≤ max_duration_ms`, sample rate 8k–192k, channels 1–8 | technical metadata | `UNSUPPORTED_MEDIA`, `CORRUPT_MEDIA`, `DURATION_EXCEEDED`, `CHECKSUM_MISMATCH` |
| Transcode | validated temp file | ffmpeg: decode → AAC-LC 48 kHz stereo provisional 160 kbps → HLS fMP4 4 s segments; `-protocol_whitelist file,pipe`; timeout = max(120 s, 4 × duration); output size cap | `index.m3u8`, `init.mp4`, `seg_*.m4s` | `TRANSCODE_FAILED`, `TIMEOUT` |
| Analyze | decoded audio | `ebur128` integrated loudness + true peak; waveform peaks (≈ 2 peaks/s, max 4000 peaks, normalized 0–1) | technical JSON, `waveform.json` | analysis failure does **not** fail the job (ML/analysis never blocks playback) |
| Store | outputs | original copied server-side to `rabit-private-originals/<storage_prefix>/original`; derivatives uploaded under `rabit-private-media/<storage_prefix>/hls/…`; tombstone re-checked before each write | AudioAsset rows | — |
| Publish | — | tombstone check; source `ready`; UploadSession `ready`; quota: reservation → usage; outbox `AudioReady` | search doc, library item | — |
| Cleanup | — | delete quarantine object; temp dir removed (always, `finally`) | — | — |

Fingerprinting is a no-op step reserved for ADR-0019.

## 3. Idempotency, retries, partial failure

- Job `audio.process` dedupe key: `audio.process:<audio_source_id>`. A retry re-runs from the start. Object keys are deterministic per source: `<storage_prefix>/original`, `<storage_prefix>/hls/…`, `<storage_prefix>/waveform.json`, where `storage_prefix = <asr id>/<random>` is chosen once when the source is created. Retries overwrite instead of duplicating, and asset rows are upserted on `(audio_source_id, kind)`.
- Retry policy: max 5 attempts, exponential backoff (2^n × 5 s, jitter). Validation failures (`UNSUPPORTED_MEDIA`, `CORRUPT_MEDIA`, `DURATION_EXCEEDED`, `CHECKSUM_MISMATCH`) are **permanent**: no retry; source `failed`, quota reservation released, quarantine object deleted.
- Storage calls fail instead of hanging: 5 s to connect, 30 s of silence on a connection (an idle limit, so long transfers are not cut off), 3 SDK attempts. Before this, a storage endpoint that accepted connections but never answered held a processing job for its whole 30-minute lease.
- Transient failures (storage/network/timeouts) retry; after the last attempt the job is `dead` (DLQ), source `failed` with `PROCESSING_FAILED`, operator can retry via ops API (which resets source to `processing`).
- If deletion was requested while processing: every write step checks the tombstone; on detection the job deletes anything it wrote and exits successfully; the deletion job also sweeps the source prefix (double coverage).

## 4. Storage namespaces and authorization paths

| Namespace | Private audio | Licensed catalog |
|---|---|---|
| Original | `rabit-private-originals` | `rabit-catalog-originals` |
| Playback | `rabit-private-media` | `rabit-catalog-media` |
| Authorization path | playback policy: workspace membership | playback policy: RightsGrant ∧ Entitlement |
| Workspace | user personal workspace | system catalog workspace |

The media gateway receives only `(bucket, prefix)` from a verified token and never takes a bucket from the request path.

## 5. Object lifecycle and deletion

| Object | Created | Deleted |
|---|---|---|
| Quarantine upload | intent PUT | after processing (success or permanent failure); expired sessions after 24 h; bucket lifecycle 2 days as backstop |
| Private original | processing | source deletion job |
| Private derivatives | processing | source deletion job |
| Export archive | export job | 24 h after ready |
| Catalog originals/derivatives | ingest | operator removal `POST /v1/ops/recordings/{id}/audio-removal` (R10): refused while a grant is in force or suspended; access ends at once, files removed by `audio.delete_source`. No automatic removal or retention period (Legal, open-questions RQ-01) |

Deletion job `audio.delete_source`: revoke sessions → delete search doc → delete all assets (list by prefix, not just rows) → delete asset rows → status `deleted` → `SourceDeleted`. Idempotent; safe to re-run.

## 6. CDN / cache (MVP and production)
- MVP: media gateway streams from object storage; responses `Cache-Control: private, max-age=<token remaining>`; manifests `no-store`.
- Production (Proposed): CDN in front of the media gateway with edge token validation; segment cache key excludes the token; revocation via short token TTL + session check at origin for manifests.

## 7. Limits (configuration; values are Q03 placeholders)

| Limit | Default |
|---|---|
| `max_file_bytes` | 500 MB |
| `max_duration_ms` | 3 h |
| `max_total_bytes` (free) | 5 GB |
| `max_concurrent_uploads` | 3 |
| presigned PUT expiry | 15 min |
| upload session expiry | 1 h |

## 8. Not in the blocking path (P2)
Stem separation, semantic/MIR analysis, ASR, embeddings. When added they run as separate jobs triggered by `AudioReady` and never gate `ready` (NFR-ARCH-005).
