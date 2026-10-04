# Music Atlas Specification (design, P2)

- Status: Phase 17 (2026-10-04). **Design only — not implemented.** Requirements: ATL-001..018, LOC-001..011. Source: AP-03, AP-08, AP-10, BRD §9, DIG §5.
- Proposed ADR to write when work starts: regional aggregation and privacy (source ADR-09).

## 1. Principle: popularity here ≠ music of here

"현지에서 많이 듣는 곡" and "그 지역을 대표하는 음악" are different questions (PB invariant 8, ATL-013). Each category answers exactly one question and says which data it uses.

| Category | Question | Data | Group |
|---|---|---|---|
| **Local Top** (NOW) | What do participating listeners *observed in this region* play most right now? | Recent verified, capped listening contributions | LIVE |
| **Rising Here** | What is gaining share here fastest? | Week-over-week share change | LIVE |
| **Local Gems** | What is played here unusually more than elsewhere? | Smoothed local share ÷ outside share | DISCOVER |
| **Local Legends** | What has been loved here for a long time? | Long-window persistence + re-listening + editorial/verified history (labelled) | CULTURE |
| **Made Here** | What was created/recorded here or by artists from here? | Evidence-backed born/active/recorded relations | CULTURE |
| **Decades** | What was released in this era here? | Release dates + legally sourced historical material | CULTURE (CNF-16 open) |

Nationwide hits appearing in Local Top are correct, not a bug; locality is answered by Gems.

## 2. Inputs and privacy model

### 2.1 What the server may receive
- **No exact coordinates, ever, by default** (LOC-003, NFR-PRV-001). In `Local` mode the device maps its position to a `region_id` at the chosen granularity (country → state/province → city) and sends only that.
- `region_id` combined with an account is still personal location information (NFR-PRV-002). Therefore:
  - Chart contribution requires its own consent, separate from personal Place Memory (LOC-004).
  - Contribution events are written to a separate aggregation store keyed by a **rotating pseudonym** (daily salt), not the user id. The link table (user → pseudonym) is kept only for fraud/eligibility checks and deleted after the window closes (retention proposal 30–90 days, Legal).
  - Access logs for region lookups do not store `user_id` with `region_id`.

### 2.2 Eligible contribution
A listening event contributes to region r only if: the session was valid, the event was accepted (PLY-015 server checks), the recording's rights allowed playback, the account is not flagged for fraud, and the per (pseudonym, recording, day) cap of **1 contribution** is not exceeded. Synthetic/test accounts are excluded.

### 2.3 "Local" vs "observed here"
The minimum product says "listening observed in this region from participating accounts". A **local-resident** chart requires a consented, user-declared home region cohort (ATL-012, Q09) and is not built until that decision.

## 3. Formulas (testable specification, versioned as `atlas/v1`)

Let `x(r,t)` be capped contributions for track t in region r over the window, `N(r) = Σ_t x(r,t)`, `U(r)` distinct contributing pseudonyms.

| Category | Window | Score | Eligibility |
|---|---|---|---|
| Local Top | 30 d | `x(r,t)` | `U(r) ≥ k_region`, track `u(r,t) ≥ k_track` |
| Rising Here | 7 d vs previous 7 d | `(s₁ - s₀) / max(s₀, ε)` with `s = x/N` | both windows eligible; `x₁(r,t) ≥ m_rise`; new-account contributions excluded for 7 d |
| Local Gems | 90 d | `affinity = p_r / p_out`, `p_r = (x(r,t) + α·p_out) / (N(r) + α)`, `p_out` = smoothed share outside r | `x(r,t) ≥ m_gem`, `affinity` capped at `A_max`; display "×n" only when the 95 % bootstrap interval excludes 1 |
| Local Legends | 365 d+ | persistence = share of months in top decile × re-listen rate; editorial picks separate and labelled | service age ≥ window, else editorial-only with label |
| Made Here | — | not a score: list of entities with `ArtistRegion` evidence (born/active/recorded), each relation labelled | evidence present |

Proposed parameters (to be tuned on holdout data, R10): `k_region = 100`, `k_track = 20` (AP-10), `α = 50`, `m_rise = 10`, `m_gem = 20`, `A_max = 20`, `ε = 1/N(r)`.

### 3.1 Test cases the implementation must pass
1. A region with `U(r) = 99` shows no chart; the UI falls back to the parent region with the message "이 지역의 공개 가능한 데이터가 아직 부족합니다".
2. A track played 1,000 times by one pseudonym contributes `≤ window days`.
3. A track with equal share in r and elsewhere has affinity ≈ 1 and is not a Gem.
4. A track absent last week (`s₀ = 0`) with 3 contributions this week is not "Rising" (`m_rise`).
5. Two snapshots for adjacent days differ by more than one contributor → no differencing attack can isolate a single user's play (fixed daily snapshots + suppression of cells < `k_track`).
6. Changing a user's location mode to Off removes them from future snapshots; personal Place Memory deletion never affects purchases (AC-16).

## 4. Publication

- Daily immutable snapshots (`ChartSnapshot`, `algorithm_version`, `window`, `eligible_population` reported as a range).
- Snapshots held for review when fraud signals exceed thresholds; corrections publish a new version, never overwrite (AP-12).
- Only geographic levels that meet thresholds are listed in the region picker.
- A chart entry links to playback; availability comes from the playback policy with the **license territory of the account**, not the Atlas region (PLY-013, ATL-014).
- Every chart shows period, method, source, sample limits and last update (ATL-008).

## 5. Dependencies before build
Q09 (thresholds, local definition), location-law review (Legal), consent UX, enough listening volume (operational data), Q10 for Legends/Decades sources, map/data licenses (ATL-017).
