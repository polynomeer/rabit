# ADR-0022: Visual design and menu structure of the web reference client

- Status: Accepted (structure, theming, font loading) / Proposed (final typeface, colour values, symbol vector — OQ-BRD-01/03/05)
- Date: 2026-10-09
- Deciders: product owner (menu, typeface approach, theme), engineering
- Related: ADR-0011 (web reference client), BRD §2–§7 and its identity board, DIG PRD §13, OQ-BRD-01/03/04/05, NFR-A11Y-*, `infra/web/csp.json`

## Context
The web reference client (ADR-0011) carried the brand colours as CSS variables but otherwise looked like a debug UI: a row of tab buttons (Archive / Playlists / Search / DIG / Account), a text glyph for a logo and an unstyled player. Three design directions were explored on a design canvas; the product owner chose **variant C**, which follows the identity board embedded in `Rabit_Brand_Design_Guide.docx` (filled rabbit-head symbol, rounded wordmark, dark surfaces with a soft purple glow, Listen / Dig / Atlas / Studio area cards).

Constraints:
- The UI typeface (OQ-BRD-01), final colour values (OQ-BRD-03), sub-brand names (OQ-BRD-04) and the symbol's final vector (OQ-BRD-05) are still open.
- The production CSP allows fonts from `'self'` only. Loading a web-font service would change the CSP and send every visitor's IP address to a third party.
- Music Atlas is P2 (location law and sample thresholds first); the server has no Atlas API.
- Studio public releases are P1 (gate Q07); private upload and Audio Log recording exist.

## Options
1. **Restyle only**: keep the five-tab menu and apply the new look. Least test churn, but the structure still mirrors API resources rather than the product areas.
2. **Variant C with available areas** (chosen): Home / Search / DIG / Archive / Studio as the main menu; Playlists and Account as secondary entries; Atlas left out until P2 ships.
3. Variant C verbatim, Atlas included as a "coming soon" screen: shows a feature that does not exist and invites location expectations before the legal review.

Typeface: (a) system fonts with the wordmark as text next to an SVG symbol (chosen); (b) self-hosted Outfit for Latin text, which would effectively settle OQ-BRD-01; (c) Google Fonts, which needs a CSP change and third-party IP disclosure.

## Decision
- **Menu.** One `nav` landmark ("주 메뉴") holds two lists: primary `Home, Search, DIG, Archive, Studio` and secondary `Playlists, Account` (plus `Ops` for operators). On screens narrower than 900 px the primary list is a fixed bottom bar and secondary entries are icon buttons in the header; wider screens show both in the header. `#/home` is the default route.
- **Studio** (`#/studio`) holds the upload form and the Audio Log recorder that used to sit at the top of the Archive. The Archive keeps the library list and links to Studio.
- **Atlas** is not shown anywhere until its P2 work starts.
- **Theme.** Dark is the default (BRD §15 "dark premium"); the light Canvas scheme follows `prefers-color-scheme`. Tokens live in `apps/web/src/styles.css`; `--accent` is the AA text/outline colour per scheme and filled controls use Rabit Purple with white text (4.7:1).
  - *Amended 2026-10-10 (owner request):* viewers can choose 기기 설정 / 다크 / 라이트 under Account. The choice is stored per device (`localStorage`, no account setting yet) and applied as `<html data-theme>`, which overrides `prefers-color-scheme`; the default stays the device setting.
- **Fonts.** The system stack (`system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif`). No web fonts, no CSP change. OQ-BRD-01 stays open.
- **Symbol.** `RabitSymbol` in `apps/web/src/brand.tsx` is a working SVG redraw of the identity board (the eye is an even-odd hole, so it needs no element ids). It is replaced when the final vector is delivered (OQ-BRD-05).

## Consequences
- Browser E2E tests open Studio to upload and the Archive to inspect the result; the mobile test covers all seven entries.
- Screen-specific redesigns follow on the same tokens. Done: Now Playing (`#/now`) with custom controls (play/pause, previous/next, a labelled position slider) driving a control-less `<audio>` element; album and recording pages with covers; DIG (centred current point, one card per axis group, connection cards where estimates have a dashed edge and every card states its reason); Archive (view chips that remain radio buttons, items grouped by month of `saved_at` or an Audio Log's `recorded_at`).
- The catalog has no artwork yet; covers are deterministic brand-palette compositions per release (`Cover`), decorative only. A track's cover is its **primary release**'s (`primary_release_id`: earliest-dated release, undated last, ties by id), returned on recording summaries, search results and library/playlist items, so a track looks the same on every screen. Real artwork should use the same key when the catalog carries images.
- Private audio and Audio Logs never get an album-style cover: they show an icon tile (`Mark`), also in the player.
- Queue entries can be `hidden` (Blind Digging, DIG-010): the player then shows a neutral tile and no album, DIG or credits links, so playing a blind track never reveals it before Keep/Pass. New player surfaces must honour this flag.
- Save buttons on detail pages show the saved state on load via `GET /v1/library?ref_id=`; list views (search results) skip that lookup to stay within the per-user rate limit.
- Studio shows upload steps (decorative; the status line remains the announced text) and the owner's five newest private items.
- Ownership badges carry a per-source class (`own-<code>`); the text label stays the primary signal (NFR-A11Y-003).

## Revisit trigger
OQ-BRD-01/03/05 decided; Atlas (P2) or Studio public releases (Q07) open; a native client (Q06) needs shared tokens.
