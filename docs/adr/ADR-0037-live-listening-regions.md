# ADR-0037: Live listening by city ("지금 들리는 음악")

- Status: Proposed (owner 2026-10-29: "권장안대로" for the values below; Legal review of location law and consent text still open, so not buildable yet)
- Date: 2026-10-29
- Deciders: product owner, engineering, Legal (pending)
- Related: [music-atlas](../03-architecture/music-atlas.md) (source ADR-09, regional aggregation), ATL-001, ATL-008–011, ATL-017, LOC-001–004, NFR-PRV-001–005, Q09, Q10, ADR-0032, ADR-0035, design canvas pages L/M/N ("지도 · 지금 들리는 음악")

## Context
The DIG map should feel alive: zoom from the world to a city and see what is being played there now. "Now, nearby" is location data joined to listening, which CLAUDE.md and NFR-PRV-001 treat as sensitive. LOC-003 forbids storing exact coordinates; ADR-0035 keeps location out of the play summary; the [atlas spec](../03-architecture/music-atlas.md) defines 30-day charts with `k_region = 100` and daily snapshots but no live layer.

## Options
1. **City-level, opt-in, delayed 15-minute aggregates from a user-chosen city** (chosen proposal).
2. Device GPS mapped to a city on the device (LOC-001 Local mode): needs an OS location permission and still yields `region_id` per account; more legal surface for the same picture.
3. Real-time per-listener dots or neighbourhood level: tracking risk; rejected.
4. No live layer, only the daily atlas charts: safe, but loses the "지금" the feature is for.

## Decision

### Participation
- **Off by default.** Only accounts that switch on "내 감상 보태기" contribute. Viewing the layer needs no consent; contributing does.
- A separate, versioned consent (NFR-PRV-004, LOC-004) with purpose "live city aggregate". Switching off stops contribution from the next window; it does not affect playback, saves or purchases (LOC-005).
- **No device location.** The user picks one listening city from a list (`region_id` at city level). The app asks for no OS location permission. A chosen city is a declaration, not proof of where someone is (ATL-012), and the UI says "참여 계정이 고른 도시" rather than "현지".

### What counts
- Only qualified plays of catalog recordings: the same rule as usage statements and ADR-0035 (≥ 30 s or half the track, once per session), on a valid session, with rights allowing playback, from an account not flagged for fraud. Synthetic and test accounts are excluded.
- Never counted: private uploads, Audio Log, previews, client-reported plays without a server session.
- At most **one contribution per (pseudonym, recording, window)**.

### Aggregation and publication
- **Granularity:** city is the finest level. The map does not zoom beyond city level, and the server has no smaller unit.
- **Windows:** fixed 15-minute windows aligned to the clock (UTC). A window is published **one window after it closes** (shown as "14:30–14:45 집계 · 15분 늦게") and is immutable after publication.
- **Thresholds:** a city appears only with **≥ 20 distinct contributing pseudonyms** in the window; a recording appears in a city's list only with **≥ 20 distinct pseudonyms**. Below that the city shows "모이는 중" and offers the parent region; nothing below threshold is published, cached or returned in an API error.
- **Counts as buckets only:** 20명+, 50명+, 100명+, 500명+. No exact numbers in the API or the UI.
- **Top list:** at most 10 recordings per city per window, ordered by bucket and then by a stable tie-break that does not reveal exact counts.
- The country/region roll-up uses the same windows and thresholds; a region that only exists because of below-threshold cities is not shown.

### Storage and retention
- Contributions go to a separate aggregation store keyed by a **daily rotating pseudonym** (salted per day), not `user_id`, as in the atlas spec §2.1.
- The `user → pseudonym` link exists only to enforce the per-window cap and fraud exclusion, and is deleted when the day's last window has been published.
- Raw contributions are deleted once their window is published; only the thresholded, bucketed window results are kept, for **7 days**, then dropped (enough for "▲▼ / 새로" and abuse review).
- Request logs for the live layer do not store `user_id` together with `region_id` (NFR-PRV-002). The chosen city is personal data of the account: shown in settings, included in the export, deleted with the account.

### Map rendering
- **Web:** MapLibre GL bundled with the app; vector tiles from a self-hosted Protomaps (OpenStreetMap) file on our own storage/CDN in the Seoul region. No third-party map requests, so map views do not leak the viewer's area to a provider, and the CSP stays as it is.
- **iOS:** MapKit.
- Style: land, sea, borders and city names only; zoom capped at city level on both.
- Attribution "© OpenStreetMap 기여자" (ODbL) on every map view; the mockups' Natural Earth drawing is for design only.

## Consequences
- New consent purpose and settings entry; consent text needs Legal review (위치정보법 and PIPA: whether a user-declared city tied to listening is location information).
- A new aggregation job every 15 minutes: idempotent per (city, window), retried, with metrics for contributors per window, suppressed cells and publication lag; a late run publishes late rather than recomputing a published window.
- With 20-listener thresholds most cities will show "모이는 중" at launch; the UI must make that normal, and the layer stays off until a city meets the threshold in staging data.
- The map feature as a whole still waits on a lawful source for artist/release regions (Q10, D04); this ADR only covers the live layer and the map base.

## Known risks
- **Differencing:** 15-minute windows are much finer than the atlas's daily snapshots (ATL-011). A user who knows another contributor's city could compare consecutive windows. Mitigations here: fixed immutable windows, one-window delay, buckets instead of counts, ≥ 20 per cell, no below-threshold output. If review finds this insufficient, the next step is calibrated noise on bucket boundaries or 60-minute windows.
- `k = 20` is lower than the atlas `k_region = 100` because a live window is short; it is not a legal anonymity guarantee (ATL-010), and the UI never calls the data "익명".
- A declared city can be false; the live layer does not claim local residency.

## Revisit trigger
Legal review outcome; a request for device-based location; threshold violations or a differencing finding in review; enough volume to raise `k` or shorten the delay.

## Open before Accepted
1. Legal review: location law applicability, consent wording, retention periods (NFR-PRV-005 lists 30–90 days for aggregation input; this ADR proposes deleting raw contributions at publication).
2. Q09 for the live layer: confirm `k = 20` for city and recording.
3. Map tile hosting cost and update cadence (Protomaps build), owned by operations.
