# Advanced Playback — Research and Design (P2)

- Status: Phase 18 (2026-10-04). **Design and experiment plan only.** Requirements: REQ-11..14 → ADV-001..006. Source ADRs to write per experiment: ADR-11 (DSP location), ADR-12 (Perceptual ABR), ADR-13 (transition/stems).
- Invariant: every feature that can alter the sound has an **Original** mode that bypasses it and is one tap away (ADV-006). No codec/bitrate numbers are fixed here without measurement.

## 1. Feature analyses

### 1.1 Musical Transition Engine (beat/key/phrase-aware transitions)
| Aspect | Design |
|---|---|
| User value | Continuous listening for mixes/playlists without jarring gaps; album order stays default |
| DSP/ML | Offline beat/downbeat, tempo, key and phrase-boundary analysis per recording (MIR jobs, see semantic-audio.md); online: equal-power crossfade at phrase boundary, optional tempo match ≤ ±3 % |
| Latency | Planner runs ahead (next-track prefetch); no added start latency |
| Battery | Crossfade + mild time-stretch on device; measure CPU on low-end devices |
| Bandwidth | Prefetch of next track's first segments only |
| Rights | Time-stretch = transformation of the master → requires `transform` use in RightsGrant (Q14); without it, only plain gapless/crossfade |
| Client/server | Server publishes analysis metadata; client executes |
| Fallback | Gapless/crossfade when metadata or rights missing; Original mode = no transitions |
| Metric | Skip rate within 10 s after transition, transition-rated satisfaction, CPU % |

### 1.2 Adaptive Loudness
| Aspect | Design |
|---|---|
| User value | Consistent level across private recordings and catalog |
| DSP | Track/album gain from stored EBU R128 integrated loudness and true peak (already measured at ingest, AUD-011); target −14 to −16 LUFS (to be chosen by test), never boost above true-peak headroom |
| Latency / battery | Negligible (static gain) |
| Rights | Gain normalization generally standard; confirm per contract (Q14) |
| Fallback | Off = Original; missing loudness → no gain |
| Metric | Volume-change events after track change, clipping incidents (should be 0) |

### 1.3 Perceptual ABR
| Aspect | Design |
|---|---|
| User value | Fewer stalls on poor networks; data saving where inaudible |
| Requirements | Multi-rendition ladder (needs ADR-0008 ladder decision), buffer-based ABR first; perceptual layer later (bitrate floor per content complexity) |
| Bandwidth | Saving claims only after ABX/MUSHRA tests (R07) |
| Honesty | The UI shows the codec actually delivered; never claims lossless when not (ADV-003, PLY-011); a user-fixed quality is always respected |
| Metric | Rebuffer ratio (NFR-PERF-002), average bitrate, blind-test preference |

### 1.4 Device-aware playback
Capability detection (codec support, output route: speaker/Bluetooth/wired) selects rendition and DSP defaults; Bluetooth codecs make lossless indistinguishable — show this explanation instead of selling "lossless" over AAC Bluetooth.

### 1.5 Personal Acoustic Model / Personal Master
| Aspect | Design |
|---|---|
| User value | Preference-based EQ profile per output device |
| Method | Paired-comparison test (A/B, loudness-matched) → EQ curve with limited gain (±6 dB) |
| Privacy | Treated as listening preference, **not** a hearing test; no health claims; profile data is personal (separate consent, deletion) |
| Fallback | Default off; Original always available |
| Metric | Retention of the setting after 14 days, A/B preference, complaints of fatigue |

### 1.6 Adaptive Mastering (environment compensation)
Ambient-noise-driven dynamic range/EQ adjustment. Microphone input is sensitive: on-device only, never uploaded, explicit opt-in (NFR-PRV-001). Changing the master's dynamics = transformation → rights gate (Q14). Strict gain limiter; failure → Original.

### 1.7 Stem Streaming
| Aspect | Design |
|---|---|
| User value | Karaoke/instrument focus, learning |
| Requirements | Licensed stems from rights holders only (no automatic separation of commercial recordings for distribution — AP-06, Legal); sample-accurate alignment, shared clock, combined loudness |
| Bandwidth | N× egress; cost model required (NFR-COST-001) |
| Fallback | Any stem late → whole-mix fallback |
| Metric | Drift (samples), stall rate, CPU |

## 2. Experiments vs production requirements

| Track | Prototype (experiment) | Production requirement |
|---|---|---|
| Loudness | Apply stored gain in the web reference client behind a flag | Policy target chosen from blind test; per-contract approval |
| Transitions | Offline planner on self-made fixtures | MIR metadata pipeline, `transform` grants, device CPU budget |
| ABR | Two-rendition ladder in staging, buffer-based | Ladder ADR, CDN cost, device matrix (Q06) |
| Personal Master | A/B UI with fixed curves | Consent flow, deletion, no-diagnosis copy review |
| Stems | Self-recorded multitrack fixtures only | Stem licenses, alignment QA, cost approval |

Each experiment has a pre-registered metric and a stop rule (`ship / iterate / defer`, AP-15 R-series).
