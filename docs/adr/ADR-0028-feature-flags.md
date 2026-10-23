# ADR-0028: Feature flags with gradual rollout and kill switches

- Status: Accepted
- Date: 2026-10-23
- Deciders: engineering (commercial quality plan CQ-ANA-2, release-readiness R12)
- Related: [commercial-quality-plan](../plans/commercial-quality-plan.md), ADR-0027, api-guidelines

## Context
Every feature is always on (R12). A paid service needs to:
- turn a feature on for a share of listeners first;
- switch a misbehaving feature off without a deploy or an App Store review;
- see who changed what.

## Options
1. **Flags in our database** (chosen): declared in code with a default, overridden per environment by operators, and evaluated on the server.
2. A vendor (LaunchDarkly, Statsig): targeting rules, experiments and dashboards. However, it adds a processor that receives user ids, and it needs an owner account.
3. Environment variables: one deploy per change, no per-user rollout, nothing for the iOS app.

## Decision
- **Declared in code**: each flag has a key, a description, a default and whether clients may read it. An unknown key cannot be set.
- **Stored overrides**: the `feature_flag` table holds `enabled` and `rollout_percent` (0–100). A flag without a row uses its default.
- **Evaluation**: a flag is on for a user when it is enabled and the user's bucket is below the rollout. The bucket is `sha256(key:user_id)` mod 100, so it is stable per user and independent across flags. Raising the rollout only adds users.
- **Propagation**: each API process caches flags for 15 seconds, so a kill switch takes effect within 15 s plus the clients' next read.
- **Clients**:
  - `GET /v1/features` returns the client-readable flags evaluated for the caller.
  - Web reads them after sign-in and on each page load; iOS reads them on launch, on sign-in and when it returns to the foreground.
  - Clients fall back to the code default when the read fails.
- **Operators**:
  - `GET /v1/ops/features` lists each flag: its default, its override and who last changed it.
  - `PUT /v1/ops/features/{key}` changes a flag. It needs a reason and is audited.
- **Never a flag** for authorization, rights, entitlement, validation, rate limits or audit logging (CLAUDE.md). A flag may hide or disable a feature, never weaken a control.
- **First flag**: `client_diagnostics` (default on), a kill switch for ADR-0027 reports if they ever flood or misbehave.

## Consequences
- Rollouts and kill switches without a deploy, auditable.
- Old flags must be removed with the code that reads them once a feature is fully rolled out. The registry makes them easy to find.
- No experiments or metrics per variant; that would be an analytics decision (CQ-ANA-1).

## Revisit trigger
- Targeting beyond a percentage (platform, app version, country).
- A/B experiments with analysis.
