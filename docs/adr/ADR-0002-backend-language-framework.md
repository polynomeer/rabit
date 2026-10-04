# ADR-0002: Backend language and framework — TypeScript, Node.js, Fastify

- Status: Accepted
- Date: 2026-10-04
- Related: ADR-0001, ADR-0010, NFR-ARCH-008

## Context
No technology stack exists in the source documents. The MVP needs an HTTP API with strict validation, a job worker, streaming of HLS bytes, and a web reference client.

## Drivers
- Strict static typing for explicit domain types (IDs, states, money, visibility) — CLAUDE.md.
- One language across server and web client lowers MVP cost.
- Mature ecosystem for PostgreSQL, S3, OIDC/JWT, OpenAPI, testing.
- Audio heavy lifting is delegated to ffmpeg, so runtime CPU performance of the API language is secondary.

## Options
1. **TypeScript on Node.js (LTS ≥ 22) with Fastify + Zod**
2. Kotlin/JVM (Spring Boot)
3. Go
4. Python (FastAPI)

## Trade-offs
| Option | Pros | Cons |
|---|---|---|
| 1 | Shared types with web client; Fastify is fast with schema-based validation; strict TS | Weaker runtime type guarantees than JVM; needs discipline for errors |
| 2 | Strong typing, mature enterprise libs | Two languages with web client; heavier |
| 3 | Simple deploys, fast | Less expressive domain modelling (no sum types) |
| 4 | Great for ML later | Typing weaker for domain invariants |

## Decision
Option 1. `typescript` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Fastify for HTTP, Zod for runtime validation of every external input (HTTP, env, job payloads, ffprobe output). pnpm workspace. Vitest for tests. ESLint (typescript-eslint, strict) + Prettier.

ML/MIR work (P2) may use Python in a separate worker; that is a future ADR (AP ADR-17).

## Consequences
Branded types for IDs (ADR-0015). Runtime validation at every boundary because TS types vanish at runtime.

## Revisit trigger
Measured CPU-bound hot path in the API that cannot be moved to the worker; team skill mismatch.
