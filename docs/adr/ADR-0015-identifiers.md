# ADR-0015: Prefixed opaque IDs and branded types

- Status: Accepted
- Date: 2026-10-04
- Related: NFR-API-002, CLAUDE.md (explicit domain types)

## Decision
- IDs are generated server-side as `<prefix>_<26-char Crockford base32 ULID>` (e.g. `aos_01J…` for AudioObject source). Prefixes are per entity type (catalogued in the [ERD](../04-data/erd.md)). The ULID time component aids index locality; IDs are not secrets and are never used as authorization.
- Stored as `text` with a `CHECK` on the prefix pattern.
- TypeScript uses branded types (`type AudioSourceId = Brand<string, 'AudioSourceId'>`) with parse functions at every boundary; IDs of different entities cannot be mixed at compile time.
- Clients must treat IDs as opaque strings.

## Revisit trigger
None expected.
