# ADR-0003: PostgreSQL as system of record, Kysely, reversible migrations

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-18 (part)
- Related: NFR-DATA-001, NFR-DATA-007, NFR-DATA-010, AP-05

## Context
AP-05 requires a relational DB as the source of truth for accounts, rights, entitlements, deletion and orders, with outbox in the same transaction.

## Options
1. **PostgreSQL 16+**
2. MySQL 8
3. Managed NoSQL

## Trade-offs
PostgreSQL offers transactional DDL (safer migrations), `SKIP LOCKED` (job queue, ADR-0005), full-text search and `pg_trgm` (ADR-0006), partial indexes, `jsonb`, and strong constraint support. MySQL lacks transactional DDL. NoSQL weakens invariants (ledger balance, unique event IDs).

Data access options: ORM (Prisma/TypeORM) vs **query builder (Kysely)** vs raw SQL. ORMs encourage entity-first modelling (PB Phase 4 warns against it) and hide transactions. Kysely is type-safe, explicit, and supports a migrator with `up`/`down`.

## Decision
- PostgreSQL 16 (local: Docker image `postgres:16-alpine`).
- Kysely for queries; SQL migrations authored as Kysely migrations with both `up` and `down`.
- Money as `bigint` minor units + `char(3)` currency; timestamps as `timestamptz` (UTC); states as `text` with `CHECK` constraints mirroring TS union types.
- Audio binaries never stored in the DB.
- Migration policy: expand/contract for anything touching populated tables; destructive steps require explicit human approval (Playbook §6, §9).

## Consequences
Rollback is tested in CI by running `up → down → up` on an empty database.

## Revisit trigger
Write volume of listening events exceeding a single primary (move events to an analytics store per AP-05); multi-region requirements.
