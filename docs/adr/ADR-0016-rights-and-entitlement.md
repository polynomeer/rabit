# ADR-0016: Capability-based rights and entitlement evaluated at access time

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-02 (part), AP-05 §불변 조건, AP-08 §재생 판단
- Related: PLY-003, PLY-008, CAT-002..004, COM-009, COM-016, COL-003, NFR-ARCH-007, CNF-09

## Context
Rights and entitlement must not be booleans (PB Phase 3). AP-03 and AP-08 list the playback checks in different orders (CNF-09); AP-00 makes AP-08 canonical for authorization.

## Decision
- **Capabilities**: `play`, `download_export` (own originals), `download_purchase` (P1), `offline` (P2), `transform` (P2), `stems` (P2), `analyze`, `publish`.
- **RightsGrant** (catalog): `uses` ⊆ {`stream`, `download`, `preview`, `transform`, `stem`, `analysis`}, `territories` (ISO 3166-1 alpha-2 set or `WORLD`), `valid_from/valid_to`, `status` (`active|suspended|revoked|expired`), `contract_ref`, `version`.
- **Entitlement**: `user_id`, `scope` (`catalog_all` for subscription, `release` / `recording` for purchase or grant), `resource_id`, `capabilities`, `origin` (`subscription|purchase|grant`), `origin_ref`, `valid_from/valid_to`, `status` (`active|suspended|revoked|expired`), `version`.
- **Ownership ≠ Entitlement ≠ Library membership**: library entries never imply entitlement; entitlements never imply copyright ownership; physical items never create entitlements (no FK/trigger path exists).
- **Playback policy** (AP-08 order, single implementation shared by playback, search, DIG preview, export):
  1. authenticated principal (anonymous allowed only for capabilities explicitly marked public — none in MVP)
  2. source exists and caller may see it (private source → owner workspace member, else `not_found`)
  3. source not tombstoned / status `ready`
  4. for catalog origin: an active RightsGrant covering `stream` in the caller's license territory now
  5. for catalog origin: an active Entitlement covering the resource with `play` now (subscription or purchase/grant)
  6. requested capability allowed by both
  7. session/device limits (MVP: none configured; hook exists)
  
  Each step returns a typed denial reason (`not_found`, `not_ready`, `rights_unavailable`, `subscription_required`, `purchase_available`, `capability_denied`). Private-source denials collapse to `not_found` externally (AP-04).
- The caller's license territory is a server-side account attribute set by the account policy (billing country/access policy), **never** from client input or Atlas region (PLY-013). The concrete legal rule for determining it is a Legal item.
- Every decision records `rights_version` and `entitlement_version` in the playback session; any change to a grant or entitlement bumps its version and enqueues revocation of sessions issued under older versions.

## Consequences
CNF-09 is resolved in code in favour of AP-08's order; AP-03's text is noted as superseded for implementation.

## Revisit trigger
Commercial contracts that require additional dimensions (device class, concurrent streams, quality tiers).
