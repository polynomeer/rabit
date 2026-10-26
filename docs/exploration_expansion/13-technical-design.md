# Technical design · Music Exploration Expansion (E0, with E1 outline)

- Status: **Proposal, not approved** (2026-10-26). Grounded in `main` at 2c7591d. Nothing here is implemented.
- Decisions it relies on: ADR-0033 (release date precision and cutoff), ADR-0034 (Time Radio through the account queue), ADR-0035 (last-played summary), ADR-0036 (exploration progress, E1). All Proposed.
- Supersedes for E0 the generic schema in [05-data-model.md](05-data-model.md); the E1 tables there stay the reference for later.

## 1. Module ownership

| Capability | Module | New code | Reuses |
|---|---|---|---|
| Date precision, eligibility helper `releasedBy(cutoff)` | `catalog` | migration, `catalog/dates.ts` exported from `catalog/index.ts` | `release`, `release_track` |
| Time Radio candidates | `dig` | `dig/time-radio.ts` | `radio.ts` per-artist cap and shuffle, `playabilities`, integrity exclusions |
| Time Radio queue mode | `playback` | `queue.ts` mode `time_machine` | ADR-0026 queue, `deps.radio` wiring |
| Artist Journey, album compare | `dig` | `dig/journey.ts` | `labels.ts` grouping, `credit`, `music_relation.valid_from` |
| Exploration context on sessions | `dig` | column + validation | `dig_session` routes |
| Last-played summary, rediscover | `library` | table, job, `library/rediscover.ts` | stream qualifying rule (`playback/usage.ts`) |
| Flags | `flags` | 4 keys | ADR-0028 |
| E1: regions, collections, quests, awards | `catalog` (regions), new `exploration` | see §8 | outbox/jobs |

Modules write only their own tables and call each other through `index.ts`, as the architecture test requires.

## 2. Data model (E0 migrations)

### 0027_release_date_precision (catalog)

```sql
ALTER TABLE release
  ADD COLUMN release_date_precision text
    CHECK (release_date_precision IN ('day','month','year')),
  -- Last day the release could have come out; NULL when the date or its precision is unknown.
  ADD COLUMN release_date_latest date GENERATED ALWAYS AS (
    CASE release_date_precision
      WHEN 'day'   THEN release_date
      -- date_trunc is not immutable for date; use immutable date arithmetic.
      WHEN 'month' THEN ((release_date - (EXTRACT(day FROM release_date)::int - 1)) + interval '1 month - 1 day')::date
      WHEN 'year'  THEN make_date(EXTRACT(year FROM release_date)::int, 12, 31)
    END) STORED,
  ADD CONSTRAINT release_precision_needs_date
    CHECK (release_date_precision IS NULL OR release_date IS NOT NULL);
CREATE INDEX release_date_latest_idx ON release (release_date_latest) WHERE release_date_latest IS NOT NULL;
```

- Backfill: `day` only where the ingest source carried a full date (DDEX `ReleaseDate`/`OriginalReleaseDate`, manifest `release_date` with day); otherwise NULL (excluded from cutoff queries). A dry-run report lists counts per source before the write.
- Down: drop the index, constraint and columns. No data loss elsewhere.
- Ingest (DDEX ADR-0030, manifest) sets precision from the source format from now on.

**Recording eligibility** (ADR-0033): a recording is released by `cutoff` when its **earliest** release containing it has `release_date_latest <= cutoff_date`.

```sql
SELECT rt.recording_id, min(r.release_date_latest) AS first_latest
FROM release_track rt JOIN release r ON r.id = rt.release_id
WHERE r.release_date_latest IS NOT NULL
GROUP BY rt.recording_id
HAVING min(r.release_date_latest) <= $cutoff_date
```

`cutoff_date` is the calendar date of `cutoff_at` in the chosen time zone (default the account's display zone; a region's zone in E1).

### 0028_play_queue_time_machine (playback) — implemented

```sql
-- 0021's unnamed CHECK has Postgres's default name, play_queue_mode_check.
ALTER TABLE play_queue
  DROP CONSTRAINT play_queue_mode_check,
  ADD CONSTRAINT play_queue_mode_check CHECK (mode IN ('queue','radio','time_machine')),
  ADD COLUMN radio_context jsonb,  -- {"cutoff_at","time_zone","mode"}
  ADD CONSTRAINT play_queue_time_machine_context
    CHECK ((mode = 'time_machine') = (radio_context IS NOT NULL));
```

Down drops the constraints and column first, then turns Time Radio queues into `radio`.

### 0029_dig_session_context (dig)

```sql
ALTER TABLE dig_session ADD COLUMN context jsonb NULL;
-- {"cutoff_at":"1983-06-15T23:59:59+09:00","time_zone":"Asia/Tokyo","view":"historical"|"modern","mode":"free_explore"|"hidden"}
```

Validated by zod at the route; unknown keys refused. The trail keeps working unchanged; the context only filters candidates and is shown in history.

### 0030_library_play_summary (library)

```sql
CREATE TABLE library_play_summary (
  user_id text NOT NULL REFERENCES app_user(id),
  recording_id text NOT NULL REFERENCES recording(id),
  last_qualified_at timestamptz NOT NULL,
  qualified_plays int NOT NULL CHECK (qualified_plays > 0),
  PRIMARY KEY (user_id, recording_id)
);
CREATE INDEX library_play_summary_last ON library_play_summary (user_id, last_qualified_at);
```

- Written only for recordings the user has saved (directly or through a saved release). One row per pair, no per-play history (ADR-0035).
- Deleted with the library item (when no saved path remains) and by the account deleter; included in the export section.

## 3. Algorithms

### Time Radio candidates (`dig/time-radio.ts`)

1. Eligible recordings: the query above, joined to `recording.catalog_audio_source_id IS NOT NULL`, minus integrity exclusions.
2. Mode filter:
   - `free_explore`: all eligible.
   - `hidden`: `recording_popularity.tier IN ('deep_cut','obscure','unknown')`; the reason says "less played on Rabit now" (EXP-026).
   - `period_radio`: refused with 422 `CHART_SOURCE_UNAVAILABLE` until charts exist.
3. Sample: deterministic shuffle seeded by `(user_id, context hash, nonce)`, at most 2 per main artist (`radio.ts` `PER_ARTIST`), no recording queued in the last 200 history items.
4. Playability: `playabilities(db, deps.catalogAccess, principal, sourceIds)`; unplayable candidates are kept only when the client asks for `include_unavailable` (info-only rows), never queued.
5. Reason: `{code: 'time_machine', params: {cutoff_date, precision}}`.

Cost: the eligibility query is an index range on `release_latest_idx` plus `release_track` by `release_id`; the sample is capped at 2,000 rows like `crates.ts`.

### Moving the cutoff ("다음 달로")

Server recomputes with the new cutoff, replaces **suggested** queue items only, and returns `new_since_previous` (releases with `previous < first_latest <= new`).

### Artist Journey (`dig/journey.ts`)

- Releases: `release_artist` (ord 0 or any credited artist; flag `featured`), grouped by year of `release_date`, ordered `(release_date_latest, release_id)`; undated in their own list.
- Events: dated `music_relation` rows where the artist is `from`/`to` (`member_of`, `signed_to`) using `valid_from`, and first credits with a producer/featured role per year. Each event carries the `DigEvidence` shape (basis, verification, source).
- `view=historical&cutoff_at=…` removes releases and events after the cutoff and hides editorial text; `view=modern` shows all.
- Compare: two releases of the same artist; facts only (date, label, producers, track count/length, featured artists) with their sources. Editorial notes are E1 (needs D02).

### Rediscover (`library/rediscover.ts`)

`library_item` (recording or release) LEFT JOIN `library_play_summary`; candidates where `last_qualified_at < now() - inactive_days` **or** no summary row and `saved_at < now() - inactive_days`. The response marks the second kind `history: 'none'` so the UI can say "감상 기록 없음 · 저장 날짜 기준".

### Summary updates

`recordListeningEvents` already decides acceptance. When a catalog session first crosses the stream qualifying threshold, the playback module emits `playback.play_qualified {user_id, recording_id, session_id, at}` to the outbox, once per session (dedupe key = session id). The library module subscribes and upserts the summary if the recording is saved. The event carries IDs only.

## 4. API (OpenAPI `x-rabit-status: planned` until implemented)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/dig/time-machine/coverage?cutoff_at&time_zone&mode` | counts: eligible releases, excluded for precision, playable now (setup screen) |
| POST | `/v1/queue/time-machine` | body `{cutoff_at, time_zone, mode, view}`; sets queue mode and fills suggestions; returns the queue (ADR-0034) |
| POST | `/v1/queue/time-machine/advance` | body `{months: 1}`; returns queue + `new_since_previous` |
| GET | `/v1/dig/artists/{artist_id}/journey?view&cutoff_at&cursor` | releases, events, undated, coverage |
| GET | `/v1/dig/artists/{artist_id}/compare?release_a&release_b` | 422 when releases belong to different artists |
| PATCH | `/v1/dig-sessions/{id}` | accepts `context` |
| GET | `/v1/me/rediscover?inactive_days=180&cursor` | owner-only |

- Errors use the existing envelope and codes: 400 `VALIDATION_FAILED` (bad date/zone/mode), 404 for others' sessions, 409 queue version conflict (ADR-0026 `version`), 422 with new codes `CHART_SOURCE_UNAVAILABLE` / `CUTOFF_UNCERTAIN` (added to `ErrorCode`).
- No endpoint accepts `region_id` for playback; `POST /v1/playback-sessions` is unchanged (EXP-027).
- Cursors encode the query hash, so a cursor from another cutoff is rejected.

## 5. Flags (ADR-0028)

`exploration_time_machine`, `exploration_journey`, `exploration_rediscover`, `exploration_compare` — all `client: true`, default off. Routes return 404 when off for the caller; clients hide the entries.

## 6. Clients

- Web: route kinds `explore` (`#/explore`, `#/explore/time`, `#/explore/rediscover`) and `journey` (`#/journey/{artist_id}`, `#/compare/{artist_id}/{release_a}/{release_b}`, following the existing `#/<kind>/<id>` hash routes); sub-navigation inside DIG (D10); Time Radio is the existing player + queue panel with the time banner.
- iOS: `DigRoute` gains `.explore`, `.timeMachine`, `.journey(ArtistID)`, `.rediscover`; RabitKit `Explore.swift` for the endpoints; queue sheet shows the cutoff banner when `mode == .timeMachine`.
- Both: list views for every visual (EXP-025); reduced motion honoured; dates rendered with their precision (EXP-024).

## 7. Observability, privacy, deletion

- Metrics: `rabit_time_machine_candidates{mode,outcome}`, `rabit_time_machine_cutoff_violations_total` (must stay 0; a post-filter assertion counts any recording whose `first_latest > cutoff`), `rabit_rediscover_candidates_total{history}`, latency histograms per route.
- Logs carry IDs and mode, never cutoff + user + region together.
- Deletion: library deleter removes `library_play_summary`; dig deleter already removes sessions (context goes with them); playback deleter already removes the queue.
- Export: library section adds the summary rows; dig section adds `context`.

## 8. E1 outline (not for implementation yet)

- `geo_region`, `entity_region_link` as in 05-data-model, owned by `catalog`, filled only from an approved source (Q10/D04).
- `exploration` module: `exploration_collection` + `exploration_collection_version` (+ items), `quest_definition`, `quest_progress`, `exploration_award` with `UNIQUE(user_id, award_key)` where `award_key = sha256(user_id, proof_event_id, award_type, ruleset_version)` (ADR-0036). Proof events come from `playback.play_qualified`, DIG steps, and library saves through the outbox.
- Historical charts: separate aggregate behind the legal gate (ADR-PROP-EX02), never shared with Atlas participant charts.

## 9. Test plan (maps to 09-delivery-plan §최소 테스트 행렬)

| # | Test | Layer |
|---|---|---|
| 1 | 1984-01-01 release never appears for 1983-12-31 cutoff | server unit + SQL |
| 2 | Year-only 1983 release excluded for 1983-06-15, included for 1983-12-31 | server unit |
| 2a | Recording first released 1981, reissued 2010: eligible for 1983 | server unit |
| 4 | Time Radio for any context leaves `license_country` and playback territory unchanged | server integration + e2e |
| 5 | Revoked rights: queued time-machine item refused at session start | server integration |
| 6 | `ml_inferred` relations never shown as verified in Journey events | server unit |
| 7 | Rediscover and sessions of another account → 404 | server integration |
| 9 | `period_radio` → 422, UI shows the disabled reason | server + e2e |
| 10 | Account deletion removes summary rows; export includes them | server integration |
| 11 | Journey and Time Radio usable by keyboard and screen reader; list fallback | e2e a11y |
| new | Cutoff change keeps chosen queue items | server integration |
| new | Summary survives the 90-day event purge | server integration |

## 10. Rollout

1. Migrations 0027–0030 with backfill report (no user-visible change).
2. Server endpoints behind flags; contract tests; OpenAPI `planned` → `stable`.
3. Web screens (D09), e2e; owner opens flags for the alpha cohort.
4. iOS screens one PR behind each web capability.
5. Usability study (5–10 people) before any E1 work starts.
