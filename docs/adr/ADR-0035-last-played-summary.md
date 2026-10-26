# ADR-0035: Last-played summary for rediscovery

- Status: Accepted (owner decision 2026-10-26: "권장안대로" — follow the recommendations in 12-plan-review §4)
- Date: 2026-10-26
- Deciders: product owner, engineering
- Related: [13-technical-design](../exploration_expansion/13-technical-design.md) §2–3, EXP-015, EXP-023, ADR-0032, Q-EXP-07, privacy

## Context
Rediscovery needs "saved and not played for 180 days". Listening events are purged after 90 days (`purgeListeningEvents`), so raw events cannot answer it, and keeping events longer would grow a sensitive history.

## Options
1. **One summary row per user and saved recording** (chosen proposal): last qualified play time and a count, updated from a `playback.play_qualified` outbox event.
2. Keep listening events for 365 days: more personal data for one feature.
3. Use only `saved_at`: cannot tell a song played last week from one never played.

## Decision
- Table `library_play_summary(user_id, recording_id, last_qualified_at, qualified_plays)`, owned by `library`, rows only for saved recordings.
- "Qualified" is the stream rule already used for usage statements (≥30 s or half the track, once per session).
- No per-play rows, no client time, no location.
- Deleted when the recording is no longer saved and with the account; included in the export.
- Without a row the UI says "감상 기록 없음 · 저장 날짜 기준" and never infers that the user did not listen.

## Consequences
- A new outbox event from playback; library subscribes idempotently (dedupe per session).
- Existing saves have no history until their next qualified play; the UI is honest about it.

## Revisit trigger
A personal listening-history feature, or a change to the event retention period.

## Implementation notes
- Migration `0030_library_play_summary` (2026-10-26). Playback emits `PlayQualified` (IDs only) in the listening-event transaction when a catalog session first reaches the stream rule; `library.record_play` upserts only for saved recordings (job dedupe per event).
- Removing a saved recording prunes its row; account deletion and `DELETE /v1/me/rediscover/history` clear them; the export carries `play_summary`.
- Not yet built: a per-account on/off switch for keeping the summary (D07 mentions a visible on/off); clearing is available.
