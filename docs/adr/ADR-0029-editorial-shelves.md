# ADR-0029: Editorial shelves on Home

- Status: Accepted
- Date: 2026-10-23
- Deciders: engineering (commercial quality plan CQ-CAT-8); curation policy is the owner's
- Related: [commercial-quality-plan](../plans/commercial-quality-plan.md), DSC-005, DIG-020, ADR-0016, ADR-0026

## Context
Home is generated from the catalog: new releases, albums on sale, a crate per decade. A music service also needs people to pick: a release to feature, a theme for the week, a shelf for one country only. Curated picks must still respect rights (nothing the listener's region cannot hear) and integrity decisions.

## Decision
- **Ownership**: the DIG module (discovery) owns `editorial_shelf` and `editorial_shelf_item`. A shelf has:
  - a title and an optional description;
  - a position on Home;
  - target territories (empty means everywhere);
  - an optional start and end;
  - a published flag;
  - up to 50 releases in curated order, each with an optional note.
- **Listeners**: `GET /v1/editorial/shelves` returns the shelves that are:
  - published;
  - inside their window;
  - targeting the listener's licence country, which is read on the server and never taken from the client.
  
  Releases are filtered with the rule new releases use: at least one track available in the region (playable now, or after subscribing or buying), and nothing excluded by a reviewed integrity decision. Empty shelves are left out. Curated order is kept; no popularity ranking (DSC-005).
- **Operators**: `/v1/ops/editorial/shelves` lists, creates, replaces and deletes shelves. Every change needs a reason and is audited. A shelf is created as a draft; publishing is a change like any other.
- **Clients** show editorial shelves first on Home, then the generated ones.

## Consequences
- Curation without a deploy; per-country shelves for launch markets.
- A shelf that loses its rights in a country shrinks or disappears there without anyone editing it.
- No scheduling of individual items, no artwork or hero banners; those wait for real artwork (CQ-CAT-4).

## Revisit trigger
- Editorial playlists of tracks rather than releases.
- Personalised ordering (it would need DSC-002/005 decisions).
