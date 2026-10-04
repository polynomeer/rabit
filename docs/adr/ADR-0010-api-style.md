# ADR-0010: REST JSON `/v1`, contract-first OpenAPI 3.1

- Status: Accepted
- Date: 2026-10-04
- Related: NFR-API-001..011, AP-07, PB Phase 6

## Options
1. **REST + JSON with OpenAPI 3.1 written before implementation**
2. GraphQL
3. gRPC

## Trade-offs
GraphQL makes per-field authorization and private-existence protection (404 vs 403) harder to audit and complicates idempotency. gRPC is poorly suited to browsers and signed media URLs. REST matches AP-07 and keeps authorization per resource.

## Decision
- `docs/05-api/openapi.yaml` is the contract and is updated **before** endpoint code (PB Phase 6, NFR-API-010).
- A contract test asserts that every implemented route exists in the spec and every spec operation is implemented or explicitly marked `x-rabit-status: planned`; responses of implemented operations are validated against the spec schemas in integration tests.
- Error envelope, pagination, idempotency, ETag rules per [api-guidelines](../05-api/api-guidelines.md).

## Revisit trigger
Client aggregation needs that REST serves poorly (measured over-fetching on mobile).
