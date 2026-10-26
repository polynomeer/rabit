# ADR-0036: Exploration progress — bounded collections, opt-in quests, idempotent award ledger

- Status: Proposed (E1; not for E0)
- Date: 2026-10-26
- Deciders: product owner, engineering
- Related: ADR-PROP-EX03 in [10-decisions-risks](../exploration_expansion/10-decisions-risks.md), [07-recommendation-game](../exploration_expansion/07-recommendation-game.md), EXP-010, EXP-011, Q-EXP-05, Q-EXP-06

## Context
The expansion proposes collections with progress and optional quests with XP. Progress must be truthful (no "% of all music"), resistant to farming, and never pressure listening (calm playback, PLY-017).

## Decision (proposed)
- New module `exploration` owning collections (`exploration_collection`, versions, items), `quest_definition`, `quest_progress` and `exploration_award`.
- Coverage = discovered eligible items ÷ items of a **named, versioned** collection; the version and denominator are always shown; old versions keep their badges.
- Awards come only from server events through the outbox: qualified plays (ADR-0035 event), DIG steps, library saves. `UNIQUE(user_id, award_key)` with `award_key = sha256(user_id, proof_event_id, award_type, ruleset_version)`; one award per entity per day; daily cap.
- Quests are off by default per account; no streaks, rankings or penalties; nothing shown over the player.
- Collections are versioned by operators through the ops console with audit (like ADR-0029 shelves).

## Consequences
- A sixth bounded context and its deletion/export hooks.
- Award logic is server-only; offline plays count only after their events are accepted.

## Revisit trigger
Public profiles or social sharing of badges (needs separate consent and moderation).
