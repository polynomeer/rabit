# Domain Boundaries

- Status: Phase 4 (2026-10-04). Architecture: [ADR-0001](../adr/ADR-0001-modular-monolith.md). Model: [domain-model](../04-data/domain-model.md).

## 1. Bounded contexts

| Context | Owns (aggregates) | Exposes (service interface) | Depends on |
|---|---|---|---|
| `identity` | User, Workspace, Membership, QuotaPolicy | `resolvePrincipal(token)`, `workspacesOf(user)`, `assertRole(workspace, role)`, `quotaFor(workspace)` | — |
| `audio` | UploadSession, AudioObject (+Version), AudioSource, AudioAsset, AudioLog | `createUploadIntent`, `finalizeUpload`, `getSource`, `listSources`, `requestSourceDeletion`, processing job handlers | identity, ops (jobs) |
| `catalog` | MusicEntity registry, Artist/Person/Label/Release/Edition/Recording, ReleaseTrack, Credit, MusicRelation, RightsGrant | `getRecording`, `activeGrants(recording, territory, use, at)`, `revokeGrant`, `relationsFrom(entity)`, `creditsOf(entity)` | ops |
| `entitlement` | Subscription, Entitlement | `activeEntitlements(user, resource, capability, at)`, `grant`, `revoke` | identity, catalog (resource existence) |
| `playback` | PlaybackSession, ListeningEvent, RecordingPopularity | `evaluatePolicy(principal, source, capability)`, `issueSession`, `refreshSession`, `revokeSessions(filter)`, `recordEvents` | audio, catalog, entitlement |
| `library` | LibraryItem, Playlist (+Items), Export | `listLibrary`, playlist commands, `requestExport` | audio, catalog, playback (policy for availability) |
| `dig` | DigSession (+TrailNodes) | `axes(entity)`, `explore(entity, axis, filters)`, session commands | catalog, playback (popularity, policy) |
| `search` | SearchDocument (derived) | `search(principal, query)`, indexers | audio, catalog |
| `integrity` | ProvenanceClaim, IntegritySignal, Report | `passportOf(recording)`, `submitReport` | catalog |
| `ops` | Job, OutboxEvent, AuditLog, AccountDeletion | `enqueue`, `emit`, `audit`, admin commands | — |

## 2. Dependency rules

1. A module may read or write only its own tables. Cross-context reads go through the owning context's service interface (enforced by an import-boundary lint rule: `src/modules/<a>/**` may import only `src/modules/<b>/index.ts`).
2. Authorization policy for audio access is implemented **once** in `playback.evaluatePolicy` (ADR-0016) and reused by library, dig, search result re-checks and export.
3. `catalog` never depends on `entitlement`; `entitlement` never creates anything from `catalog` physical data (COL-003 — there is no physical context in MVP at all).
4. Derived data (`search`, popularity) can always be rebuilt from canonical tables.
5. Cross-context side effects after commit flow through outbox events → jobs (ADR-0005), never through in-transaction calls into another context's tables.

## 3. Affected-context checklist for changes

When a change touches: access to audio → `playback.evaluatePolicy` tests; private data → `search` + `library` + `dig` + `export` negative tests; rights or entitlement → session revocation; schema → migration up/down test.
