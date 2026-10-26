# Plan review and additional planning · Music Exploration Expansion

- Status: **Proposal, not approved** (2026-10-26). Builds on files 00–11 of this package; it does not change [prd.md](../01-requirements/prd.md), [mvp-scope.md](../01-requirements/mvp-scope.md) or any Accepted ADR.
- Companion documents: [13-technical-design.md](13-technical-design.md) (design against the current code), [14-design-mockups.md](14-design-mockups.md) (screens on the design canvas), ADR-0033…0036 (Proposed).

## 1. What the package gets right, and what the code says

The package's principles (cutoff without future leaks, rights evaluated only by `playback`, evidence-labelled relations, bounded progress, opt-in games) match Rabit's rules and need no change. Checking it against `main` (2026-10-26) changes the **order** of work, because some building blocks exist and some data does not:

| Package assumption | What exists today | Consequence |
|---|---|---|
| Release dates with precision | `release.release_date date NULL`, no precision, no market (`schema.ts:375`) | Add precision first (ADR-0033); market-specific dates wait for D01 |
| Regions for entities | **No** origin/active/recorded region on any entity; territory exists only for rights and accounts | Atlas/region features cannot start before a lawful region data source exists (Q10). Move all region work to E1 |
| Genre filters | No genre data (`crates.ts:20` says so) | Drop genre from E0; collections are curated lists instead |
| Time Radio candidate engine | `dig/radio.ts` already builds explained candidates (samples → producer → influences → artist → member → label → **decade**) for autoplay; `crates.ts` already filters releases by year | Time Radio is a new candidate source in DIG plus a queue mode, not a new engine |
| Play queue | Account queue with autoplay and reasons (ADR-0026, `play_queue`) | Time Radio feeds the existing queue (ADR-0034); no second player |
| Trail | `dig_session` / `dig_trail_node` with evidence per step | Store the exploration context on the session; no new trail table |
| Listening history for "180 days not played" | `listening_event` is **purged after 90 days** (`listening.ts:203`) | Rediscovery cannot use raw events; needs a last-played summary (ADR-0035) |
| Meaningful listen | Two definitions exist: stream (≥30 s or half, once per session) and popularity listener | Quests and rediscovery reuse the stream definition |
| Label timeline, lineage graph | Exist on web (lineage is web-only) | Relation Explorer extends lineage/connections rather than a new graph |
| Feature flags | `flags` module with server and client checks (ADR-0028) | Every capability ships dark behind a flag |
| Account deletion / export | Deleters and export sections registered in `app/registry.ts` | Every new table plugs in from its first migration |

## 2. Revised phasing

The E0/E1/E2 lanes stay, but E0 is cut to what current data supports. Nothing here re-prioritises the repository's P0/P1/P2.

### E0 — on existing data (no new external sources)

| ID | Scope | Depends on |
|---|---|---|
| EX-01 | Release date precision + cutoff eligibility rule; backfill preview report | ADR-0033 |
| EX-02 | Artist Journey read model: releases by date (album/EP/single/compilation from `release_type`), undated group, credit/relation events with dates (`valid_from`), historical/modern view | EX-01 |
| EX-03 | Album compare: two releases of one artist, facts from catalog/credits only; editorial notes later | EX-02 |
| EX-04 | Time Radio: cutoff (+ time zone), modes `free_explore` and `hidden` (labelled "less played on Rabit now"); `period_radio` shown disabled until charts exist | EX-01, ADR-0034 |
| EX-05 | Exploration context on DIG sessions (cutoff, view, mode), restorable from the URL | — |
| EX-06 | Rediscover: saved items not played for ≥180 days, with saved date vs release date; honest "no history" states | ADR-0035 |
| EX-07 | Flags, metrics, deletion/export, negative rights tests, accessibility and list fallbacks | all |

**E0 exit:** future-release leaks 0, rights bypass 0, cross-account reads 0; usability sessions done (11-validation-research §1); E0 flags still default-off for listeners until the owner opens them.

### E1 — needs new data or legal gates

Regions and the map (needs a lawful source: Q10 / D04), curated collections and coverage (needs an editor owner: D05), quests and the award ledger (ADR-0036, D06), market-specific release dates (D01), the "known at the time" perspective for editorial text (D02). Historical charts stay behind the legal gate (D03, ADR-PROP-EX02); the UI already shows the mode as disabled.

### E2 — unchanged from 09-delivery-plan

Parallel artist timelines, live month-by-month progression, spatial+temporal relation graph, long campaigns.

## 3. Requirement refinements (additions to 02-prd-requirements)

| ID | Requirement | Acceptance |
|---|---|---|
| EXP-021 | Time Radio plays through the account queue: candidates become autoplay items with a reason `time_machine`; changing the cutoff replaces only suggested items, never the user's chosen ones | Chosen items unchanged after a cutoff change; history kept (ADR-0026) |
| EXP-022 | Every exploration capability has its own feature flag, default off | Flags listed in `flags.ts`; clients hide entries when off |
| EXP-023 | Last-played summary per user and saved item, updated from qualified plays, kept beyond the 90-day event purge, deleted with the account | Rediscovery works for items last played >90 days ago |
| EXP-024 | Precision is shown wherever a historical date is: "1983-04-21", "1983-04", "1983 (year only)" | No date is shown with more precision than stored |
| EXP-025 | The map and every graph have an equivalent list view with the same filters and results | Keyboard/VoiceOver path completes U1–U3 without the map |
| EXP-026 | "Hidden" Time Radio mode names its basis as current Rabit listening, never "unknown at the time" | Copy reviewed; no historical claim from `recording_popularity` |
| EXP-027 | Region choice never reaches playback: no `region_id` in playback requests; `license_country` unchanged | Contract test + negative e2e (test matrix #4) |

## 4. Recommendations for the open decisions (owner decides)

These are recommendations, not decisions. They are registered as Q-EXP-01…10 in [open-questions](../00-product/open-questions.md).

| ID | Question | Recommendation | Why |
|---|---|---|---|
| D01 | First release worldwide or in the chosen market? | **Worldwide first release** in E0; market dates in E1 when a region is chosen | Our data has one date per release and no market; market dates need new ingest (DDEX `ReleaseDate` per territory) |
| D02 | How to prove a text was known at the time? | Historical view shows **only catalog facts dated ≤ cutoff**; all editorial text is "modern" until a source with a publication date exists | Avoids inventing "known-at" metadata |
| D03 | Historical chart licences | Do not start until legal review; keep the disabled mode in UI; budget question to the owner | Redistribution risk is high (10-decisions-risks) |
| D04 | Map precision | **City-level** for scenes; evidence = label/editorial with source; no street-level | Matches Atlas privacy rules and our sources |
| D05 | Who versions collections? | Operators through the existing ops console (like editorial shelves, ADR-0029) with audit and versioning | Reuses tooling and audit |
| D06 | When is XP awarded? | On the stream qualifying rule (≥30 s or half), once per entity per day, max 50 awards/day, revoked if the play is later rejected | Same rule as usage statements; no new definition |
| D07 | Consent and retention for the personal timeline | Uses only Rabit's own saves/plays; covered by the existing purpose (library) with a visible on/off; summary kept while the item is saved, deleted with it or the account; **no external history import** in E0/E1 | Minimises new collection (ADR-0032 spirit) |
| D08 | Commercial rights for previews/covers/metadata | Treat as the existing rights grant; exploration adds no new use | Playback evaluates every start |
| D09 | Which client first? | **Web first** for E0 (fastest iteration, e2e coverage), iOS follows each capability one PR later | Web has the lineage UI and test stack already |
| D10 | Menu placement | A **"탐험" entry inside DIG** (sub-navigation), not a new primary tab; Atlas becomes its own entry only after E1 | Keeps the five primary tabs (ADR-0022) |

## 5. UX decisions taken in the mockups

- **Rights are stated where people choose.** The setup screen and the map say that the chosen region only scopes listening; candidates show "재생 가능" or "이 지역에서 재생할 수 없음 (정보만 보기)".
- **Precision is visible.** Queue rows carry "날짜 정밀도 · 일/월/연"; the setup screen explains that year-only releases appear only after the year ends; the journey has a separate "발매일 미확인" group.
- **Unavailable modes are shown disabled with the reason** ("공식 차트 사용 허가 전"), never filled with an invented chart.
- **Two perspectives:** "그때 알려진 것만" (default for Time Radio) and "지금의 해설까지" (default for Journey).
- **Evidence styles do not depend on colour alone:** solid line + "검증된 사실", long dash + "신고된 정보", dotted + "추정"; the map legend uses shape (filled dot, ring, triangle, dashed diamond).
- **Games are quiet:** quests are off unless switched on; no in-player progress; level text says it records activity, not skill; badges are private.
- **Honest empty states:** "편집팀이 아직 확인한 연결이 없어요 — 데이터가 없다는 뜻이지, 음악이 없다는 뜻은 아니에요".

## 6. Metrics

E0 measures only with existing data and cohort aggregates (ADR-0032): qualified discovery (first qualified play then save, per exploration session), trail depth, journey completion, rediscovery success, week-4 return, playback failure by reason. The analytics events in 11-validation-research are **not** collected until a privacy review accepts them; dashboards derive from `dig_session.context`, queue items with reason `time_machine`, `library_item`, and the last-played summary.

## 7. Risks added by this review

| Risk | Mitigation |
|---|---|
| Release dates in our catalog are often reissue dates, so "1983" shows a 2010 remaster | Prefer the earliest release containing the recording; flag compilations; backfill report lists suspicious dates |
| Precision backfill marks real day dates as "day" without proof | Backfill sets `day` only for sources that carry full dates (DDEX, manifest); others `NULL` = unknown and excluded |
| Last-played summary becomes a new history store | Store one timestamp + count per saved item, nothing per play; deleted with the item |
| Time Radio drains the catalog for sparse years | Show counts before starting (setup screen) and stop with an explicit state when candidates run out |
