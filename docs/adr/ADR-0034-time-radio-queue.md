# ADR-0034: Time Radio through the account play queue

- Status: Proposed
- Date: 2026-10-26
- Deciders: product owner, engineering
- Related: ADR-0026 (play queue and autoplay), ADR-0033, [13-technical-design](../exploration_expansion/13-technical-design.md) §3–4, EXP-021, EXP-027

## Context
Time Radio plays a stream of candidates released before a cutoff. Rabit already has one server queue per account with chosen and suggested (autoplay) items and reasons (ADR-0026). A second player or queue would split history, rights checks and settlement.

## Options
1. **A queue mode `time_machine`** (chosen proposal) with a stored context; suggestions come from a DIG candidate source instead of track-based radio.
2. A separate time-radio session with its own queue: duplicates history, conflicts with "one queue per account".
3. Client-side list: loses server-side cutoff enforcement and rights re-checks.

## Decision (proposed)
- `play_queue.mode` gains `time_machine`; `radio_context` holds cutoff, time zone, mode and view.
- Starting or moving the cutoff replaces **suggested** items only; chosen items and history stay.
- Each suggestion carries the reason `time_machine` with the cutoff date and precision.
- Playback is unchanged: every session start re-evaluates rights and entitlement for the account's licence country; the context never reaches playback.
- Leaving the mode (choosing queue or radio) clears `radio_context`.

## Consequences
- One history and one settlement path for all listening.
- Autoplay refresh needs the context to stay within the cutoff; covered by tests.

## Revisit trigger
Shared or collaborative radios, or offline playback.
