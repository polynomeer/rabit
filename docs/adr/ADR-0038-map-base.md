# ADR-0038: Map base for DIG maps

- Status: Accepted (owner decision 2026-10-31: split from ADR-0037 and confirmed with the recommended stack)
- Date: 2026-10-31
- Deciders: product owner, engineering
- Related: [ADR-0037](ADR-0037-live-listening-regions.md) (live layer), [music-atlas](../03-architecture/music-atlas.md), ATL-001, ATL-017, NFR-PRV-001–002, ADR-0012 (deployment), ADR-0022 (web visual design), `infra/web/csp.json`

## Context
The era map and the live city layer need real geography: coastlines, borders and city names, with zoom from the world to a city. A hosted map provider would receive each viewer's IP and the area they look at, which conflicts with treating location as sensitive. The web client runs under a strict CSP (`'self'` scripts, no third-party origins), and the map style should match Rabit's palette rather than a road map.

## Options
1. **MapLibre GL + self-hosted OpenStreetMap vector tiles (Protomaps) on web; MapKit on iOS** (chosen).
2. Google Maps or Mapbox hosted tiles: per-load billing, viewer area sent to the provider, CSP has to allow their scripts and origins.
3. Static SVG maps (Natural Earth) only: no tiles to host, but no smooth zoom or city labels beyond what we draw by hand.

## Decision
- **Web engine:** MapLibre GL JS bundled with the app (its CSP build, so workers come from `'self'`/`blob:` already allowed).
- **Web data:** one Protomaps PMTiles extract built from OpenStreetMap, plus glyphs and sprites, served from our own storage behind the existing CDN in the Seoul region. No request leaves our origins when a map is shown; `infra/web/csp.json` gets no new third-party origin. If the tiles live on the media origin, that origin is already in `connect-src`.
- **iOS:** MapKit with a muted style and dark mode. Apple receives the map requests as it does for any MapKit app; the app never sends the user's position, and the live layer needs no location permission (ADR-0037).
- **Style:** land, sea, borders and city names only; no roads, POIs or buildings. Colours come from the design tokens in light and dark.
- **Zoom cap:** city level on both platforms. Nothing finer than a city is rendered or requested, matching the smallest aggregation unit.
- **Attribution:** "© OpenStreetMap 기여자" visible on every web map (ODbL); MapKit shows Apple's own attribution. The Natural Earth drawings in the design canvas are for mockups only.
- **List parity:** every map view has an equivalent list (ATL-001), so the map is never the only way to reach a city or an era.

## Consequences
- A tile build and upload step in operations (refresh cadence: quarterly is enough for borders and city names), with storage and transfer cost in the AWS budget.
- The web bundle grows by MapLibre (lazy-loaded on the map route only).
- The CSP e2e test (`apps/web/e2e/csp.spec.ts`) covers the map route once it exists.
- ODbL obligations apply to the tiles we serve; Legal confirms what, beyond attribution, applies when our own city aggregates are drawn on top (ATL-017).

## Revisit trigger
Tile hosting cost beyond budget, a need for detail below city level (which would also need a privacy decision), or MapKit limits on styling.
