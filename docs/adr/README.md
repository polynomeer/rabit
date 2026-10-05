# Architecture Decision Records

## Process

- File: `docs/adr/ADR-NNNN-<kebab-title>.md`. Numbers are never reused.
- Status lifecycle: `Proposed → Accepted | Rejected → Superseded by ADR-NNNN` (AP-15). Records are never deleted.
- Sections: Status, Date, Deciders, Related requirements, Context, Drivers, Options, Trade-offs, Decision, Consequences, Revisit trigger.
- **Accepted** = decided and binding for implementation. **Proposed** = analysis done, a human decision is still required (Playbook §9: cost-increasing managed infrastructure, licensing, legal, etc.) or evidence is insufficient. Code may depend on a Proposed ADR only through an abstraction with a documented provisional default.
- Reversing an Accepted ADR requires a human decision (Playbook §9).

## Index

| ADR | Title | Status | Source ADR (AP-15) |
|---|---|---|---|
| [0000](ADR-0000-adr-process.md) | ADR process and numbering | Accepted | — (CNF-17) |
| [0001](ADR-0001-modular-monolith.md) | Modular monolith with separate worker and media gateway | Accepted | ADR-01 |
| [0002](ADR-0002-backend-language-framework.md) | Backend: TypeScript, Node.js, Fastify | Accepted | — |
| [0003](ADR-0003-relational-database.md) | PostgreSQL as system of record, Kysely, reversible migrations | Accepted | ADR-18 (part) |
| [0004](ADR-0004-object-storage.md) | S3-compatible object storage with namespace separation | Accepted (provider: Amazon S3 Seoul) | ADR-15 (part) |
| [0005](ADR-0005-jobs-and-events.md) | Postgres job queue and transactional outbox | Accepted | ADR-18 |
| [0006](ADR-0006-search-graph-vector.md) | Postgres full-text + trigram search, relational graph, no graph/vector DB | Accepted | ADR-08 |
| [0007](ADR-0007-transcoding.md) | ffmpeg/ffprobe transcoding in an isolated worker | Accepted (tooling, Fargate isolation) | ADR-04 (part) |
| [0008](ADR-0008-streaming-delivery.md) | HLS delivery via short-lived playback sessions and a media gateway | Accepted (protocol, access model, CloudFront) / Proposed (codec ladder, DRM) | ADR-04, ADR-05 |
| [0009](ADR-0009-authentication.md) | External OIDC; JWT verification via JWKS | Accepted (approach) / Proposed (provider) | ADR-02 |
| [0010](ADR-0010-api-style.md) | REST JSON `/v1`, contract-first OpenAPI 3.1 | Accepted | — |
| [0011](ADR-0011-client-strategy.md) | Web reference client for MVP; native platforms pending Q06 | Accepted (web reference) / Proposed (platforms) | — (Q06) |
| [0012](ADR-0012-deployment.md) | Containers on AWS Seoul, IaC in OpenTofu | Accepted | — |
| [0013](ADR-0013-observability.md) | Structured logs, correlation IDs, OpenTelemetry, Prometheus metrics | Accepted | — |
| [0014](ADR-0014-audio-identity-and-dedup.md) | Source-scoped access, no cross-account dedup | Accepted | ADR-03 |
| [0015](ADR-0015-identifiers.md) | Prefixed opaque IDs and branded types | Accepted | — |
| [0016](ADR-0016-rights-and-entitlement.md) | Capability-based rights and entitlement evaluated at access time | Accepted | ADR-02 (part) |
| [0017](ADR-0017-provenance-representation.md) | Internal provenance claim schema; C2PA later | Accepted (internal schema) / Proposed (C2PA) | ADR-07 |
| [0018](ADR-0018-payments-and-ledger.md) | Payments, ledger and settlement | Proposed (Commercial Gate) | ADR-06 |
| [0019](ADR-0019-fingerprinting.md) | Audio fingerprinting and edition identification | Proposed | ADR-10 |
| [0020](ADR-0020-shared-rate-limits.md) | Rate-limit counters shared in Postgres | Accepted | R13 |
| [0021](ADR-0021-workspace-key-scope.md) | Per-workspace encryption scope through envelope encryption | Proposed | NFR-SEC-004 |

### Source ADRs not yet written (P2, Proposed when work starts)

| Source | Topic | Planned in |
|---|---|---|
| ADR-09 | Regional aggregation and privacy | Phase 17 spec ([atlas](../03-architecture/music-atlas.md)) |
| ADR-11 | DSP execution location | Phase 18 ([advanced playback](../08-audio-ai/advanced-playback.md)) |
| ADR-12 | Perceptual ABR | Phase 18 |
| ADR-13 | Transition and stems | Phase 18 |
| ADR-14 | Location Drops | P2 |
| ADR-16 | Privacy and E2EE | P2 (NFR-SEC-005 applies meanwhile) |
| ADR-17 | External ML providers | Phase 19 ([semantic audio](../08-audio-ai/semantic-audio.md)) |
