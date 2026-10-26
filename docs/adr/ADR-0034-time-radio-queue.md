# ADR-0034: Time Radio through the account play queue

- Status: Accepted (owner decision 2026-10-26: "권장안대로" — follow the recommendations in 12-plan-review §4)
- Date: 2026-10-26
- Deciders: product owner, engineering
- Related: ADR-0026 (play queue and autoplay), ADR-0033, [13-technical-design](../exploration_expansion/13-technical-design.md) §3–4, EXP-021, EXP-027

## Context
Time Radio plays a stream of candidates released before a cutoff. Rabit already has one server queue per account with chosen and suggested (autoplay) items and reasons (ADR-0026). A second player or queue would split history, rights checks and settlement.

## Options
1. **A queue mode `time_machine`** (chosen proposal) with a stored context; suggestions come from a DIG candidate source instead of track-based radio.
2. A separate time-radio session with its own queue: duplicates history, conflicts with "one queue per account".
3. Client-side list: loses server-side cutoff enforcement and rights re-checks.

## Decision
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

## Implementation notes
- Migration `0028_play_queue_time_machine` (2026-10-26): mode `time_machine`, `radio_context {cutoff_at, time_zone, mode}` required exactly in that mode.
- Candidates: `dig/time-radio.ts` (five years up to the cutoff first, ≤2 per artist, playable now, integrity exclusions). Each batch is re-checked against the cutoff; drops are counted in `rabit_time_machine_cutoff_violations_total`.
- Moving the cutoff keeps the current track; starting plays the first suggestion when nothing chosen waits.
