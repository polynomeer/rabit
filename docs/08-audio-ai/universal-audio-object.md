# Universal Audio Object

- Status: Phase 9 (2026-10-04). Model: [domain-model §3.2](../04-data/domain-model.md). Invariant: **AudioObject ≠ Audio File** (PB §11).

## 1. Purpose
One playback interface for catalog recordings, private uploads and Audio Logs — while rights, ownership and visibility stay separate (AUD-001).

## 2. Layers

| Layer | Answers | Identity | Mutable? |
|---|---|---|---|
| AudioObject | "What is this thing?" (`recording`, `private_audio`, `audio_log`) | `aob_` | current version pointer only |
| AudioVersion | "Which exact content?" (hash, duration, technical metadata, optional recording link) | `aov_` | immutable |
| AudioSource | "Through which channel and under whose control/rights is it available?" (origin, workspace, visibility, status) | `asr_` | status/title/tombstone |
| AudioAsset | "Where are the bytes?" (original, HLS, waveform) | `ast_` | immutable rows; deleted with source |

## 3. How the player sees it
The player receives `audio_source_id` (or a `recording_id` that the server resolves to the catalog source) and asks for a playback session. It never sees buckets or keys. The UI labels the source (`Private`, `Audio Log`, `Streaming`, `Purchased`, `Granted`) — BRD "Ownership Visible".

## 4. Same recording, different sources
A user may later (P1, DM-01) have a private live recording linked to a catalog recording. They remain distinct sources with distinct capabilities and assets; playing one never authorizes the other (AP-05 §데이터 계약).

## 5. External representation (API)
See `AudioSource` in [openapi.yaml](../05-api/openapi.yaml): includes `audio_object_id`, `version_id`, `kind`, `origin`, `visibility`, `status`, `capabilities`, `technical`; excludes fingerprints, hashes of other users, storage keys and owner workspace IDs for non-owners.

## 6. Versioning
Re-processing (new codec ladder) creates new derivative assets for the same source after the ADR changes; a new master upload creates a new AudioVersion (P1 Studio). Versions are never edited in place.
