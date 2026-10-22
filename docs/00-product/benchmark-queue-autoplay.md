# Benchmark: YouTube Music and Spotify — home, now playing, queue and autoplay

- Status: 2026-10-22, input to [ADR-0026](../adr/ADR-0026-play-queue-and-autoplay.md).
- Sources: the public apps (web, iOS) and their help pages as of 2025–2026. Behaviour changes often; this records the patterns, not pixel details.

## 1. Home

| | YouTube Music | Spotify | Rabit today (2026-10-22) |
|---|---|---|---|
| Structure | Mood chips on top, then shelves: "Listen again", "Quick picks" (songs), mixes, new releases, charts | Recently played grid (6–8 tiles), then shelves: "Made for you", recently played, new releases, charts | Search, the four areas, then shelves: new releases, on sale, by decade (#134); recent DIG sessions; saves |
| Personal shelves | Many, driven by listening | Many, driven by listening | None yet (no listening-based ranking: DSC-005) |
| Explanations | Rare ("Because you listened to …" on some mixes) | "Because you listened to …" shelves | Every DIG link names its basis (DSC-006) |

## 2. Now playing

| | YouTube Music | Spotify |
|---|---|---|
| Layout | Artwork, title, controls; tabs **Up next · Lyrics · Related** | Artwork, controls; queue and lyrics in separate views (side panel on desktop) |
| Persistent player | Mini player on every screen | Mini player / bottom bar on every screen |

## 3. Queue — what is played next

| | YouTube Music | Spotify |
|---|---|---|
| Model | One list, **Up next**. Playing a song or album replaces what is upcoming. Songs already played stay **above** the current one: scroll up to see and replay them. | Three sections: **Now playing**, **Next in queue** (songs added with "Add to queue", they play before anything else), **Next from: <album/playlist>** (the context). Played songs move to **Recently played**. |
| Adding | "Play next" and "Add to queue" on every song | "Add to queue" (end of Next in queue); no "play next" on mobile for a long time |
| Saving | "Save" on the queue makes it a playlist | Select all in the queue, then add to playlist (desktop) |
| Clearing | Remove items one by one; playing something new replaces the rest | "Clear queue" for the manual section |
| Sync | Queue follows the account across devices | Queue follows the account (Spotify Connect) |

## 4. Autoplay and radio — when the list runs out

| | YouTube Music | Spotify |
|---|---|---|
| Default | **Autoplay on**: when Up next ends it keeps adding similar songs; a toggle sits at the top of the queue | **Autoplay on** (setting "Autoplay similar content"): after the context ends, similar songs start |
| What drives it | The **current song**: Up next is regenerated from the song you are on, so it drifts with your choices | The context that ended (album/playlist) and recent listening |
| Steering | Filter chips on Up next (e.g. Familiar, Discover, Popular, Deep cuts) regenerate the list | Smart Shuffle mixes recommendations into a playlist (marked); "Go to song radio" |
| Start from a song | "Start radio" on any song replaces Up next with a radio of that song | "Go to song radio" opens a generated playlist |
| Visible as recommended | Mixed into Up next, not marked | Autoplay section and Smart Shuffle songs are marked |
| Explanations | None | None, beyond "Because you liked …" on shelves |

## 5. Playlists and history

| | YouTube Music | Spotify |
|---|---|---|
| Playlists | Separate from the queue; "Save queue" bridges them | Separate; Liked Songs is a built-in playlist |
| History | Library → History: everything played, by day | Recently played (artists, albums, playlists, songs) |

## 6. What Rabit takes, and what it does not

**Adopt**
- **History in the queue** (YouTube Music): played items stay above the current one, so the queue reads as "what I listened to, and what comes next". This is what the owner asked for.
- **Separate manual queue from recommendations** (Spotify): the listener sees what they chose apart from what was suggested, and can keep or drop suggestions.
- **Autoplay that follows the current track** (YouTube Music): the suggestions after the current track are regenerated from it whenever a new track starts.
- **Save as playlist** for the whole queue, for the chosen part or for the suggestions (both).
- **Queue on the account**, so web and iOS show the same queue.
- **Play next / Add to queue / Start radio** on tracks and albums.

**Do differently, because of Rabit's principles**
- **Explain every suggestion** (DSC-006): "같은 프로듀서 · Jung Min-ah", "이 곡을 샘플링", "같은 레이블". Neither benchmark does this; it is Rabit's DIG graph showing through.
- **No engagement ranking** (DSC-005): suggestions come from verified or declared catalog relations and the listener's own choices of steering. They do not come from click-through rates. ML-inferred links are left out unless the listener turns on "추정 관계 포함", as in DIG.
- **Calm playback** (PLY-017) and **album-first** (REQ-23): autoplay never cuts into an album or a queue the listener built. It only continues after the chosen items end.
- **Private audio stays private** (DSC-004): it can be queued, but it is never a seed or a suggestion for anyone.
