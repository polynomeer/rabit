# Demo catalog

A fictional catalog for local development and the browser tests. Every name is invented and every recording is synthesised (CAT-008: no third-party audio).

| Set | Source | Contents | Used by |
|---|---|---|---|
| `core` | [catalog/core.json](catalog/core.json) | 2 releases, 5 tracks (Harbour Lights, Paper Sky) | browser tests (`apps/web/e2e`): they assert its titles, lengths and rights, so keep it stable |
| `expansion` | [catalog/expansion.json](catalog/expansion.json) | 25 releases from 1976 to 2026, 92 tracks, 6 labels, 16 artists, 24 people; credits, samples, covers, remixes, members, label rosters, provenance claims, 16 albums on sale | `pnpm dev` / `pnpm demo:seed` |

`pnpm dev` (or `pnpm demo:seed`) generates and ingests both sets once; `pnpm dev` also puts the priced albums on sale through the operator API (`pnpm demo:offers`). To generate by hand: `node infra/demo/generate.mjs <set>` writes `out/<set>/manifest.json`, the audio files and `offers.json` (all gitignored). Delete `out/<set>` to regenerate the audio.

## What the expansion covers

- **Decades** for crate digging: releases from 1976, 1979, 1981, 1984, 1986, 1994–2009, 2010–2019 and 2021–2026.
- **DIG axes**: shared producers and engineers across labels, band members (`member_of`), label rosters (`signed_to`), samples, covers (including a 1997 and a 2023 cover of 1980s songs), remixes and remasters, and ML-inferred influences with a confidence.
- **Provenance**: human, AI-assisted and AI-generated claims, with different verification states.
- **Rights**: KR, KR+JP and WORLD grants; one EP with no grant ("not available in your region") and one album whose grant expired on 2025-12-31.
- **Masters**: 16-bit and 24-bit WAV, a 96 kHz master (rendered at 48 kHz), 48 kHz WAV, FLAC and lossy MP3 (shown as not lossless by the master QC). Loudness differs per release, so normalisation has work to do.
- **Codes**: fictional ISRCs (`ZZRBT…`, ZZ is not a real country prefix) and UPCs in the internal-use range (`2…`).

## Source format

```jsonc
{
  "source": "demo-expansion-v1",                // manifest source name
  "defaults": { "credit": { "method": "human", "basis": "declared", "verification": "distributor_verified" } },
  "labels":  [{ "key": "moonlit", "name": "Moonlit Alley Records" }],
  "people":  [{ "key": "jung", "name": "Jung Min-ah" }],
  "artists": [{ "key": "tram", "name": "Midnight Tram", "label": "moonlit", "members": ["lim"] }],
  "releases": [{
    "key": "tram-night", "title": "Night Tram Diaries", "type": "album", "label": "moonlit",
    "date": "1979-06-15", "artists": ["tram"],
    "format": "wav16",                             // wav16 | wav24 | hires | wav48 | flac | mp3 | sine
    "sound": { "root": 196, "mode": "major", "bpm": 112, "level": 0.32 },
    "rights": { "territories": ["KR"], "uses": ["stream", "preview"], "until": "…" },  // null: no grant
    "price_krw": 8800,                             // optional: on sale in KR
    "credits": [{ "person": "jung", "role": "producer" }],   // every track
    "claims":  [{ "stage": "composition", "method": "human" }],
    "tracks": [{ "key": "last-tram", "title": "Last Tram to Euljiro", "sec": 34, "credits": [] }]
  }],
  "relations": [{ "from": "tram-flip", "to": "last-tram", "type": "samples", "basis": "verified_fact", "verification": "rights_reviewed", "license": "licensed" }]
}
```

Track keys default to `<release>-<n>`; give one a `key` to point relations at it. Unknown keys are reported by the generator. A set counts as ingested when its first release exists, and catalog ingest is not idempotent: after changing a set that is already in your database, run `pnpm db:reset`.
