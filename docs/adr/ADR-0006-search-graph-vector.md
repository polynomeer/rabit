# ADR-0006: Postgres full-text and trigram search, relational graph, no graph/vector DB

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-08; DIG §12 OQ-DIG-01
- Related: DIG-023, NFR-ARCH-003, SRC-001..003, SRC-009, PB Phase 14/15

## Context
MVP search covers artist, release, recording, credits/person and the user's own private audio. DIG MVP needs one-hop and multi-hop relation browsing (credits, same producer, same label, covers, samples). Semantic/vector search is P2.

## Options
1. **PostgreSQL**: `tsvector` + GIN for full text, `pg_trgm` for fuzzy matching, relation edge tables with indexes for graph traversal.
2. Dedicated search engine (OpenSearch/Meilisearch) + graph DB (Neo4j) + vector DB.

## Trade-offs
Option 2 adds three stateful systems and makes ACL pre-filtering and deletion propagation harder (index lag can leak deleted private data). DIG MVP queries are bounded hops from one node, which indexed edge tables serve well. Option 1 keeps visibility filters in the same SQL statement as the match (no post-filter-only reliance, PB Phase 15).

## Decision
- Search documents live in a `search_document` table (owner scope, visibility, kind, entity ref, `tsvector`, normalized text for trigram). Every query includes the scope predicate in SQL: `(visibility = 'public' AND kind IN catalog kinds) OR (owner_workspace_id = ANY($callerWorkspaces))`. Results are re-checked against the canonical tables before return.
- Exact identity matches (ISRC, UPC, exact title) are ranked separately from fuzzy matches; popularity is not a ranking input in MVP.
- DIG relations in `music_relation` with indexes on `(from_entity_id, relation_type)` and `(to_entity_id, relation_type)`. Multi-hop traversal uses iterative queries bounded by depth.
- A `SearchIndex` port isolates the implementation so a dedicated engine can replace it.
- Semantic search extension point: `search_document` has a `kind` and the API has a `mode` parameter reserved (only `text` implemented).

## Revisit trigger
p95 search latency over NFR-PERF-004 at measured corpus size; traversal patterns needing deep (>3 hop) path queries; P2 semantic search (vector store decision gets its own ADR).

## Amendment 2026-10-23: Korean search (CQ-SRC-1)
- **Initial-consonant search**: `rabit_initials(text)` (SQL, used by both the indexer and the query) turns Hangul syllables into initial consonants and keeps letters and digits. A query with a lone consonant (ㄴㅈㅅ, 뉴진ㅅ) matches `search_document.initials` (trigram index) and ranks names that start with it first.
- **Aliases**: `music_entity.aliases` holds an entity's other names (romanization, English or former names), from the catalog manifest. They are exact keys and searchable text of the entity, and searchable text of its tracks and releases.
- **Exact matches compare composed text**. Full-text and trigram text keeps Hangul decomposed into jamo, so a syllable still being typed and a one-jamo typo match.
- **Spacing-insensitive** substring match (푸른밤 → 푸른 밤).
- **Word similarity** ranking, so aliases don't dilute the match on the name; a name that starts with the query ranks higher.
- **Judged query set**: `apps/server/test/korean-search.test.ts`. Every case must put the expected result first; add a case for each real query that fails.
- Still to measure at catalog scale (CQ-SRC-3): the unanchored `LIKE` on space-stripped text cannot use an index.
