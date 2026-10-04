# ADR-0014: Source-scoped access, no cross-account dedup

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-03 (UAO identity와 dedup)
- Related: AUD-002, AUD-003, AUD-010, AUD-016, CLAUDE.md (no silent dedup of private uploads)

## Context
Two users may upload byte-identical files. Deduplicating them would leak existence (timing/size side channels, "already uploaded" responses) and merge entitlements across users.

## Decision
- Every upload creates its own `AudioObject → AudioVersion → AudioSource → AudioAsset` chain in the uploader's workspace. Content hashes are stored but never used to share objects, storage, or derivatives across workspaces. API responses never reveal whether another account has the same hash.
- Authorization is decided on `AudioSource` (origin, workspace, visibility, rights context). An `AudioObject` ID alone grants nothing.
- Fingerprint/hash similarity can only create a **merge candidate** for human/owner review in P2; automatic merges are forbidden.
- Within one workspace, identical re-uploads are allowed and create separate sources (the user may want both); a UI hint may be added later using same-workspace hashes only.

## Consequences
Higher storage cost for duplicates; accepted for privacy (AP-06).

## Revisit trigger
Storage cost per user beyond the free-tier budget (Q03/Q12) — even then, only same-workspace dedup may be considered.
