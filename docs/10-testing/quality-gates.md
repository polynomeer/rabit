# Quality Gates

- Status: Phase 21 (2026-10-04).

## Per change (CI, `.github/workflows/ci.yml`)
1. `pnpm lint` — ESLint strict type-checked + Prettier
2. `pnpm typecheck`
3. `pnpm build`
4. `pnpm test` — includes migration rollback, contract and architecture tests
5. OpenAPI lint (Redocly)
6. `pnpm audit --prod --audit-level high`

A change that alters a public API updates `openapi.yaml` in the same commit (the contract test fails otherwise). A schema change adds a reversible migration and updates the ERD.

## Internal alpha (M0 / P0 exit, mvp-scope §0.7)
| Criterion | Evidence |
|---|---|
| No cross-account private access | negative test matrix (test-strategy §2) green |
| Idempotent upload/finalize/jobs | queue + finalize tests |
| Deletion propagation + tombstones | deletion tests incl. delete-during-processing |
| Rights revocation ≤ 60 s | revocation test + `RevocationLagging` alert |
| DIG evidence/provenance on every edge | DIG tests |
| Clean-clone bootstrap | README commands verified (Phase 10/23) |

## Before any external user (additional, human decisions)
Production worker sandbox (ADR-0007/0012), hosting/CDN/KMS (ADR-0004/0008/0012), legal review of private cloud storage (rights-model G-LOCKER), privacy notice and retention periods (Legal), on-call (Q18), backup/restore drill evidence.
