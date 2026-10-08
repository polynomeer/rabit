# DIG MVP Specification

- Status: Phase 14 (2026-10-04). Requirements: DIG-001–007, DIG-018–023, DIG-025. Code: `apps/server/src/modules/dig/`.
- DIG is a core product axis (product owner decision, CNF-01). Recommendation ≠ DIG: the system shows possible paths and their reasons; the user chooses (DIG-001).

## 1. Axes

| Axis | Group | Applies to | Derived from |
|---|---|---|---|
| `credits` | people | recording, release → contributors; person/artist → credited recordings | `credit` |
| `same_producer` | people | recording | shared `producer` credit |
| `session_musicians` | people | recording | shared `performer` credit |
| `artists` | people | recording, release | `recording_artist`, `release_artist` |
| `members` / `member_of` | people | artist, person | `music_relation member_of` (in/out) |
| `tracks` | history | release, artist | `release_track`, `recording_artist` |
| `releases` | history | recording, artist, label | tracklists, `release.label_id` |
| `same_label` | history | recording, release | shared label |
| `samples` / `sampled_by` | history | recording | `music_relation samples` (out/in) |
| `covers` / `covered_by` | history | recording | `music_relation covers` |
| `remix_of` / `remixes` | history | recording | `music_relation remix_of` |
| `influenced_by` / `influences` | history | recording, artist, person | `music_relation influenced_by` |

`sound` (Similar Sound, Instrument) and `place` (Local Scene) groups are reserved for P2 (DIG V2/V3) and return no axes in MVP (OQ-DIG-10 partly answered: MVP exposes only axes backed by stored data).

## 2. Evidence on every connection (DIG-004, DIG-018)

`evidence = {basis, verification_state, source, confidence, license_status, explanation, reason}`.

- `reason = {code, params}` is the explanation as a code plus names/role codes, so
  clients localize it; `explanation` stays as the English sentence for existing
  clients and as the fallback for unknown codes. Trail nodes stored before `reason`
  existed return `reason: null` (additive change, no migration).

- Credit- and relation-based connections carry the stored provenance.
- Shared-person axes (`same_producer`, `session_musicians`) take the **weaker** of the two credits.
- Structural catalog metadata (artists, tracklists, labels) is shown as `declared` / `self_declared` from source `catalog`: it is supplier data, not independently verified.
- `ml_inferred` relations carry `confidence` and can be excluded with `include_inferred=false`.
- `license_status` describes permission to use (e.g. a sample), independent from the factual relation.

## 3. Ordering (DIG-019)

MVP order: evidence strength (`verified_fact` > `declared` > `ml_inferred`), then name. Popularity is **not** a ranking signal. Novelty/diversity re-ranking and the integrity exclusion hook (`excludedEntities`, DIG-020) are wired; the integrity rules arrive with Phase 16.

## 4. Deep Cut — relative popularity (DIG-007)

Policy `popularity/v1`, recomputed daily (`playback.compute_popularity`):

1. A **listener** of a recording = a user whose accepted played time for it in the last 90 days is ≥ min(30 s, half the duration). Events are server-validated (session ownership, wall-clock bound, duplicates ignored).
2. `percentile` = share of catalog recordings (with audio) that have **strictly fewer** listeners. Absolute counts (`distinct_listeners`) are stored separately and never used by the filter.
3. No qualifying listens anywhere → all percentiles `null` → tier `unknown`.
4. Tiers: `top` ≥ 0.9, `upper` ≥ 0.5, `deep_cut` ≥ 0.1, `obscure` < 0.1, `unknown` = null.
5. Filters apply to recording targets: `any`; `below_top_50` (< 0.5); `deep_cuts` (< 0.25); `obscure` (< 0.1). **Unknown always passes**, so new or unheard artists are never filtered out for lack of plays.

Thresholds are proposals; they are versioned in `policy_version` and revisited with real data (R-series evaluation).

## 5. Sessions and trails (DIG-005, DIG-022, DIG-025)

- Start from a catalog entity, or from the caller's own audio. Own audio enters the graph only through an explicit catalog link (Audio Log `linked_recording_id`); otherwise the session opens with `empty_state.reason = no_catalog_link`. Never from another user's audio (404).
- A step names the target entity and axis (optionally the relation/credit id). The server recomputes the parent's connections and rejects edges that do not exist (`422 INVALID_RELATION_STEP`, T29). Evidence is snapshotted on the node.
- Going back moves the cursor; nodes are never deleted. Branching from an earlier node is recorded via `parent_seq`.
- Node actions: `played`, `saved`. Summary: nodes, distinct artists, axes used, played, saved.
- Trail → private playlist of its recordings in trail order, each once.
- Sessions are private. Public trails/crates wait for a moderation policy (OQ-DIG-07, P1).
- DIG history is included in the user's export and deleted with the account.

## 6. Open items

OQ-DIG-01 (graph storage — relational tables chosen, ADR-0006), OQ-DIG-06 (supplier data licensing for credits/samples — Legal), OQ-DIG-07 (public trails), OQ-DIG-08 (Dig Session Summary stage: summary fields implemented in the session view; persisted Archive summary P1).

## Label Digging, basic (DIG-011, V1)

`GET /v1/dig/labels/{label_id}/timeline` lays a label's releases on a time axis:
- releases are grouped by year, with undated releases last;
- each artist gets a span on the label: first and last year, and number of releases.

It uses only stored catalog data (`release.label_id`, `release_date`, `release_artist`), returns up to 1000 releases (`truncated` beyond that), and hides entities excluded by a reviewed integrity decision, as every DIG read does. The web client shows it on label pages.

Not included, for lack of data: genre change over time, sub-labels, scenes (DIG-012, OQ-DIG-04).

## Blind Digging (DIG-010, V1)

`POST /v1/blind-digs` deals up to 10 recordings in random order. They come from the start entity's connections on every axis, or from the whole catalog when no start entity is given, and each one must be:
- playable by the caller (rights and entitlement at deal time);
- not excluded by integrity;
- within the popularity ceiling (unknown popularity passes).

Before a decision, an item carries only its id, position and recording id, so the normal playback path, with all its checks, can play it. Artist, release, year and popularity stay hidden.

`POST /v1/blind-digs/{id}/items/{item_id}/decision` with `keep` or `pass` reveals the recording, its first release and its popularity tier. Keep also saves it to the library. A decision is final: repeating it is accepted, changing it is 409.

Hiding is a choice the user makes for their own discovery, not a secret kept from them: a determined user could look up the recording id. The player also shows a masked title.

Rounds are private, deleted with the account and exported with the DIG history (`blind_digs`).

## Crate Digging, private (DIG-009, V1 part)

`GET /v1/dig/crate?from&to&popularity&size` returns a random crate of up to 24 albums.
- **Era:** albums released in the given years.
- **Playable:** every album has at least one track the caller can play.
- **Popularity:** an album counts as popular as its most popular track; unknown popularity passes.
- **Hidden:** albums and artists excluded by a reviewed integrity decision.

Nothing is stored; saving uses the library.

Not included:
- location and genre conditions, which need data the catalog does not have;
- public crates and crate sharing, which need a moderation policy (OQ-DIG-07, DIG-024).

