# ADR-0026: Play queue with history, saved playlists and track-based autoplay

- Status: Accepted (queue model, autoplay sources, both lists manageable) / **Proposed default mode** (the owner may switch it; see §Default)
- Date: 2026-10-22
- Deciders: product owner (history-style queue, separate playlists, selectable default, autoplay that follows the track), engineering
- Related: [benchmark](../00-product/benchmark-queue-autoplay.md), PLY-001, PLY-006, PLY-014, PLY-017, DSC-003–006, REQ-23, DIG-021, ADR-0011, ADR-0016

## Context
Playing a track or an album replaced the web player's queue, which lived only in the browser tab: nothing accumulated, nothing carried over to iOS, and when the list ended playback stopped. The owner asked for a queue that builds up like a history (YouTube Music), playlists managed separately, recommendations that follow the current track, and a choice of which of the two drives playback by default.

## Options
Where the queue lives: (1) **on the account (server)** — chosen, the same queue on web and iOS; (2) per device.
What playing does: (1) **append and play** — the queue grows, played items stay as history (chosen); (2) replace the queue (both benchmarks for albums).
Suggestions: (1) **catalog relations with a reason** — chosen (DSC-005/006); (2) listening-based ranking — refused for now (DSC-005, no model, privacy work first).

## Decision
- **One queue per account**: items in order, each with an `origin`:
  - `user`: chosen by the listener;
  - `autoplay`: suggested, with its reason.
  - Played items keep a `played_at` and stay above the current item, so the queue reads as history plus what comes next. History beyond the newest 200 played items is trimmed; the queue holds at most 500 items. Private audio can be queued by its owner and is never a seed or a suggestion.
- **Actions**:
  - **Play now**: the item goes right after the current one and plays.
  - **Play next**: same position, without playing it now.
  - **Add to queue**: goes after the listener's other chosen items, before any suggestions.
  - Albums and playlists enter in their own order.
  - Also: remove, keep a suggestion (it becomes `user`), clear upcoming or clear history, and save the whole queue, the chosen items or the suggestions as a playlist. Playlists stay separate and are managed as before.
- **Autoplay**:
  - When the current item is the last chosen one and autoplay is on, the server fills the rest of the queue with suggestions seeded by the current track. Every time a new track starts, the suggestions after it are regenerated from that track, as in YouTube Music.
  - Suggestions are catalog recordings the listener can play now. They come from the DIG graph, closest first:
    1. samples, covers and remixes, in both directions;
    2. people credited on the seed (same producer, composer, engineer, …);
    3. the same artist;
    4. other projects of band members;
    5. the same label;
    6. the same decade.
  - Each suggestion shows its reason, for example "같은 프로듀서 · Jung Min-ah".
  - ML-inferred relations are used only when the listener turns on "추정 관계 포함" (the DIG setting).
  - Not more than two tracks per artist in a batch, nothing played in the last 50 queue items, integrity exclusions apply. Suggestions are not ranked by listening counts.
- **Mode** (per account, both always available):
  - **재생목록 모드**: playing adds to the queue. Suggestions come only after the listener's chosen items.
  - **자동추천 모드**: playing starts over from the new choice, like "start radio". Everything that was coming next (chosen and suggested) is replaced by the new item followed by its suggestions. History stays. Playing an album or playlist still plays it whole before suggestions (REQ-23).
  - **Autoplay switch** (default on): with it off, playback stops at the end of the chosen items in either mode.

## Default (Proposed, the owner's call)
**재생목록 모드 with autoplay on.**
- Playing never throws away what the listener chose, and the queue doubles as a listening history. That is what was asked for, and it matches PLY-017 (calm playback) and REQ-23 (album-first).
- Playback still does not stop dead: when the chosen items end, track-based suggestions continue. Both benchmarks also default autoplay to on.
- 자동추천 모드 suits lean-back listening ("start radio from this song"). It stays one switch away in Account, and "이 곡으로 자동추천 시작" is offered on every track in either mode.

## Consequences
- Queue writes (play, next, keep, regenerate) are server calls. The web and iOS players follow the server's queue and current item.
- Suggestions are only as good as the catalog's credits and relations, which is the point (Explain Discovery). A catalog with few relations falls back to label and decade.
- Listening-based personalisation, if ever wanted, needs its own ADR (privacy, DSC-004/005).

## Status of the clients (2026-10-22)
- **Web**:
  - the player follows the server queue;
  - Now Playing shows 지난 곡, 지금 재생, 내가 고른 다음 곡 and 자동추천, with reasons, keep and remove;
  - save as playlist: all, chosen or suggested;
  - 다음에 재생, 재생목록에 추가 and 이 곡으로 자동추천 on track and album pages;
  - Account → 재생 방식.
- **Blind Digging** plays from a local list: its tracks must stay hidden (DIG-010).
- **iOS** follows `/v1/queue` like the web: play now / next / end, current item on every advance (including the gapless hand-over to a queued item), a queue sheet with reasons, keep and remove, the autoplay switch and save-as-playlist, and the 재생 방식 settings. Blind Digging still plays from a device-local list, so its tracks never reach the account queue.

## Revisit trigger
Listener feedback on the default; a curated or personalised recommendation source (DSC-002 M2).
