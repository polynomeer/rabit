# ADR-0020: Rate-limit counters shared in Postgres

- Status: Accepted
- Date: 2026-10-05
- Related: R13 (release readiness), T25 (threat model), api-guidelines §8, ADR-0003 (Postgres-first infrastructure)

## Context
Per-user and per-route limits (api-guidelines §8) were counted in each api process's memory. With N api instances, a user effectively got N times every limit, including abuse-sensitive ones (uploads 30/hour, reports 20/hour, exports 5/day). More than one api instance is expected in any hosted environment (R13).

## Options
1. **Postgres counters** (chosen): no new infrastructure (ADR-0003). One `INSERT … ON CONFLICT … RETURNING` per request increments the counter, starts a new window and returns the remaining time, all on the database clock.
2. Redis: the plugin ships a Redis store and Redis is the conventional choice, but it adds a service to operate, secure and back up for a single feature.
3. Sticky routing per user at the load balancer: in-memory counting stays correct only until a rebalance or a restart, and depends on an undecided hosting choice (ADR-0012).

## Decision
- `RATE_LIMIT_STORE=postgres` (default) uses the `rate_limit_counter` table (`UNLOGGED`: counters are disposable; a crash resets them instead of costing WAL writes on every request). `memory` remains for local experiments and is refused when `NODE_ENV=production`.
- Fixed windows per key: `rl:<user>` for the global limit, `rl:<METHOD><route>:<user>` for per-route limits.
- **Failure behaviour: fail-open.** If the counter update fails, the request is allowed. The failure is logged and counted (`rabit_rate_limit_store_errors_total`, alert `RateLimitStoreFailing`). Reason: the same database serves the request itself, so failing closed would add 429s on top of a database outage without protecting anything. Accepted risk: limits are not enforced while the store fails.
- Expired counters are purged by worker housekeeping (every 30 s).

## Consequences
- One extra database write per authenticated `/v1` request. Measured locally (`apps/server/bench/rate-limit-store.ts`): p50 1.1 ms sequential and 2.5 ms with 32 concurrent callers, about 8,000 updates/s. p99 was 14–28 ms on a Docker laptop. The api baseline (performance-baseline) should be re-measured with limits enabled on staging.
- Hot keys (one user's burst) serialize on one row lock. Acceptable at the configured limits.

## Revisit trigger
Counter updates above 5 % of database CPU or p99 > 20 ms on staging; a Redis instance introduced for another reason.
