# Rabit Engineering Instructions

Execution guide: [docs/RABIT_CLAUDE_CODE_PLAYBOOK.md](docs/RABIT_CLAUDE_CODE_PLAYBOOK.md).
Latest Accepted ADRs and the PRD take precedence over fixed prompts in the playbook.

## Required workflow
Understand → Inspect → State assumptions → Plan → Implement → Test → Review diff → Update docs → Report risks.

## Commits
- Commit every unit of work. Follow [CONTRIBUTING.md](CONTRIBUTING.md) (Conventional Commits, English).
- One logical change per commit.

## Rules
- Read relevant `/docs` before changing architecture or behavior.
- Never silently resolve an architectural, rights, security, privacy, audio-format, or public-API decision.
- Create/update an ADR before material architectural decisions.
- Keep changes scoped; do not perform unrelated refactoring.
- Prefer explicit domain types for IDs, states, rights, visibility, source type and money.
- Never trust client-supplied ownership, rights, subscription, region or entitlement claims.
- Treat uploaded audio and metadata as untrusted input.
- Treat exact location as sensitive.
- Never infer copyright ownership from file possession.
- CD ownership does not imply entitlement to Rabit's licensed digital master.
- Do not silently deduplicate different users' private copyrighted uploads into one shared entitlement object.
- Distinguish verified factual provenance from ML-inferred relationships.
- Background jobs require idempotency/deduplication and retry semantics.
- Persistent schema changes require migration and rollback consideration.
- Critical paths require metrics/logs/traces and explicit failure behavior.
- New APIs require tests and API documentation.
- Never weaken auth, rights checks, validation, rate limits or audit logging to make tests pass.
- Never delete failing tests without documenting the intentional behavior change.
- Never claim completion while required checks fail.

## Before coding
1. Read the task and relevant docs.
2. Inspect current code and tests.
3. Identify affected bounded contexts.
4. List assumptions/open questions.
5. Produce a small implementation plan.
6. Stop for approval when the task crosses an unresolved ADR, legal gate or destructive migration.

## Definition of Done
- behavior implemented
- relevant tests pass
- typecheck/lint pass
- migration considered
- authorization/rights reviewed
- observability added where required
- docs/API updated
- diff self-reviewed
- unresolved risks reported
