# ADR-0001: Modular monolith with separate worker and media gateway

- Status: Accepted
- Date: 2026-10-04
- Source topic: AP ADR-01 (서비스 경계)
- Related: NFR-ARCH-001, NFR-ARCH-002, NFR-ARCH-004, PB Phase 3

## Context
Rabit's MVP spans identity, audio ingest, playback, library, catalog/rights, entitlement, DIG, search and integrity. The team size is unknown, traffic is pre-launch (A04 is a sizing example, not a forecast). The audio data plane (large byte transfer, transcoding CPU) has very different scaling and failure characteristics from the metadata/control plane.

## Drivers
- MVP operability with a small team; one deployable to reason about.
- Clear bounded contexts so contexts can be extracted later.
- Isolation of untrusted media decoding from the API process.
- Separation of control plane (authorization decisions) from data plane (byte delivery).

## Options
1. Microservices per context from day one.
2. Single monolith process doing API, transcoding and media delivery.
3. **Modular monolith codebase with three process roles**: `api` (control plane), `worker` (async jobs incl. transcoding), `media` (data-plane gateway serving HLS bytes after token verification).

## Trade-offs
| Option | Pros | Cons |
|---|---|---|
| 1 | Independent scaling/deploys | Distributed transactions, ops overhead, premature (PB §10) |
| 2 | Simplest | Decoder exploit or CPU spike takes down the API; byte serving competes with API latency |
| 3 | One codebase and one DB transaction boundary; process isolation where it matters | Module boundaries must be enforced by convention/lint, not network |

## Decision
Option 3. One repository, one TypeScript application package with modules under `src/modules/<context>`. Modules expose a narrow service interface; cross-module access to another module's tables is not allowed except through that interface. Three entry points: `api`, `worker`, `media`. All share PostgreSQL as system of record.

Bounded contexts (initial): `identity`, `audio` (UAO, upload, processing), `playback`, `library` (archive, playlists, export, deletion), `catalog` (catalog metadata, credits, rights grants), `entitlement`, `dig`, `search`, `integrity`, `ops` (audit, admin, jobs).

## Consequences
- Worker can run in a more restricted sandbox than the API (ADR-0007).
- The media gateway can later be replaced by a CDN with signed URLs/cookies without changing the control-plane contract (ADR-0008).
- A module dependency check is part of lint.

## Revisit trigger
Independent scaling need proven by measurement (e.g. worker queue depth starving API), team growth causing deploy contention, or a context requiring a different runtime.
