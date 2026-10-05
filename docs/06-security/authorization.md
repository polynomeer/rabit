# Authorization

- Status: Phase 7 (2026-10-04). Policy decision: [ADR-0016](../adr/ADR-0016-rights-and-entitlement.md). Roles: AP-08.

## 1. Principals

| Principal | How established | MVP |
|---|---|---|
| User | Verified OIDC token (`sub`, `iss`), `email_verified=true` on first login | ✅ |
| Operator | User + role claim `rabit:operator` + `amr` contains `mfa` | ✅ |
| Worker | Process identity (no HTTP); DB role for jobs | ✅ |
| Anonymous | none | ❌ (all `/v1` require auth) |
| Studio roles (viewer/editor/publisher/owner) | Membership | Model only (personal workspace owner); studio workspaces P1 |

## 2. Resource matrix

| Resource | Read | Write | Not-owner response |
|---|---|---|---|
| Upload session | creator | creator (finalize/cancel) | 404 |
| AudioSource (private) | workspace member | owner (title, delete) | 404 |
| AudioSource (catalog) | via catalog/recording endpoints | operator/ingest only | — |
| Waveform | same as source + source `ready` | — | 404 |
| AudioLog | author's workspace | author | 404 |
| Playback session | creator | creator (refresh) | 404 |
| Listening events | — | session owner | event rejected `not_owner` |
| Recording/Release/Entity/Passport | any user | ingest/operator | — |
| LibraryItem | owner | owner | 404 |
| Playlist | owner | owner (If-Match) | 404 |
| Export | requester | requester | 404 |
| Entitlements/Subscription | self | operator | — |
| DIG session | owner | owner | 404 |
| Report | — (reporter sees own id only) | any user (rate-limited) | — |
| Rights grants, entitlements (ops), jobs, license country | operator | operator (+reason, audit) | 403 |
| User support summary (`/v1/ops/users/{id}/support-summary`) | operator (+reason, audited per view); counts, states and ids only, never private content (OPS-007) | — | 403 |

## 3. Playback policy

Implemented once (`playback/policy.ts`), order per ADR-0016:

```text
principal active? ──no──▶ deny UNAUTHENTICATED/FORBIDDEN
source visible to principal? ──no──▶ deny not_found (404)
source ready & not tombstoned? ──no──▶ deny not_ready / deleted
origin = catalog?
   ├─ territory = user.license_country (server-side); null ⇒ rights_unavailable
   ├─ active RightsGrant(stream, territory, now)? ──no──▶ rights_unavailable (403)
   └─ active Entitlement(play, resource ∈ {catalog_all, release ∋ rec, recording}, now)?
          ──no──▶ subscription_required (403)   [purchase_available reserved for P1 offers]
capability ∈ allowed set? ──no──▶ capability_denied (403)
allow (record rights_version, entitlement_version)
```

## 4. Enforcement points

| Point | What is enforced |
|---|---|
| Request schema | Rejects unknown fields → client cannot send owner/role/rights/entitlement/region |
| Repository functions | Require a `Principal` argument; queries always include owner scope |
| Policy | Single function used by playback, library/playlist availability, DIG playability, search re-check |
| Media gateway | Token signature + expiry + session active |
| Ops routes | Operator guard + MFA + reason + audit (same transaction) |
| Database | App role cannot UPDATE/DELETE `audit_log` |

## 5. Negative test matrix (required)

For every owner-scoped resource family: user B gets 404 on read/update/delete of user A's resource; user B cannot add A's source to a playlist (404), start DIG from it (404), find it via search (absent), export it (absent), or play it (404). Entitlement: forged body fields → 400; without entitlement → 403; revoked → 403 and existing session refresh → 403; media after revocation → 403 within token lifetime.
