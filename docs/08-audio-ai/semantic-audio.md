# Semantic Audio and Sound Digging — MIR Design (P2)

- Status: Phase 19 (2026-10-04). **Design only.** Requirements: SRC-004..006, SRC-011, DIG-013/014, LOG-006. Source ADR to write: ADR-17 (external ML providers) and a vector-store ADR (ADR-0006 revisit).
- Rule: **evaluation dataset and metrics are defined before implementation** (PB Phase 19).

## 1. Analysis levels

| Level | Outputs | Use |
|---|---|---|
| Track | BPM (+confidence), key/mode, loudness (already stored), duration, track embedding | Filters, transitions, Similar Sound candidates |
| Segment | Section boundaries (intro/verse/chorus…), beats/downbeats, instrumentation activity per segment, timbre embedding per window, transcript spans (Audio Log, opt-in) | Sound/Instrument Digging, Timeline, "find the moment" |

Segments use `TimelineSegment {source_id, layer, start_ms, end_ms, payload_ref, confidence, model_version}` with `0 ≤ start < end ≤ duration` (NFR-DATA-009). Proposed windowing (OQ-DIG-02, to be evaluated): 3 s windows with 1.5 s hop for timbre embeddings; section layer from a structure model.

## 2. Provenance of every derived value

Each value stores: `model_id`, `model_version`, `input_asset_sha256`, `created_at`, `confidence`, `basis = ml_inferred`. Manual corrections are separate versions and are never overwritten by re-analysis (AP-05). In UI, inferred values are labelled as estimates; a vector neighbour is shown as "sounds similar (estimated)", **never** as a fact like "same instrument" or "same guitarist" (PB Phase 19).

## 3. Pipeline

`AudioReady` → `mir.analyze_track` (CPU) → `mir.embed_segments` (GPU/CPU) → index. Never in the blocking ingest path (NFR-ARCH-005). Inputs are only sources whose rights allow `analysis` (CAT-009) or the owner's private audio with analysis consent (LOG-006). Private embeddings are stored per workspace and searched only with an owner pre-filter (same rule as text search, T05). Deletion removes segments and vectors (LIB-008).

## 4. Retrieval

Hybrid: metadata/graph candidates (DIG axes) ∪ vector neighbours (segment-level) → ACL/rights pre-filter → integrity exclusion → rerank by similarity with diversity constraint. Unauthorized candidates never reach a reranker or LLM (SRC-007).

## 5. Re-index strategy

- Embeddings are keyed by `(model_version, source)`. A new model version is backfilled in the background into a parallel index; queries switch when coverage ≥ 99 % and offline metrics are not worse; old index deleted after a grace period.
- Vector store choice: start with Postgres `pgvector` if latency targets hold (ADR-0006 revisit trigger); a dedicated vector DB only with an Accepted ADR (NFR-ARCH-003).

## 6. Evaluation before build

| Task | Dataset (rights-cleared) | Metric | Gate |
|---|---|---|---|
| Section detection | Self-produced and licensed multitrack songs with hand-labelled boundaries | Boundary F-measure @ 0.5 s | ≥ agreed baseline |
| BPM / key | Labelled licensed set across genres | Accuracy (BPM ±4 %), key MIREX score | Per-genre breakdown reported |
| Sound Digging retrieval | Query segments with human similarity judgements (3 raters) | nDCG@10, Recall@50; false "same instrument" claims = 0 by construction | Beat metadata-only baseline |
| Audio Log ASR (Korean/English) | Consented recordings | WER by language/accent | Per-group parity reported |
| Humming search (M3) | Consented hums | MRR | — |

Splits stratified by genre, language, era, device and codec; leakage checks (same recording in train/test) required. Bias reporting by genre/new-artist share (AP-10).
