# Domain Boundaries

- Status: Phase 4 (2026-10-04); table ownership enforced 2026-10-19 (architecture review). Architecture: [ADR-0001](../adr/ADR-0001-modular-monolith.md). Model: [domain-model](../04-data/domain-model.md).

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
| `collection` | PhysicalItem | physical collection commands | catalog (read) |
| `commerce` | Offer, PurchaseOrder, PaymentEvent, PaymentRefund, Ledger, App Store account link | orders, offers, subscriptions through a provider, webhooks | catalog (read), entitlement (issue/revoke in the caller's transaction), identity |
| `ops` | Job, OutboxEvent, AuditLog, AccountDeletion | `enqueue`, `emit`, `audit`, admin commands | audio, catalog, identity |

## 2. Dependency rules

1. A module **writes** only its own tables; other modules call the owner's functions (exported from its `index.ts`), which may run in the caller's transaction. **Reads** of another module's tables are allowed only as listed read models (e.g. dig and search read the catalog). Both rules are enforced by `test/architecture.test.ts`: imports go through `index.ts`, every table has one owner, writes outside the owner and unlisted reads fail the build. The one listed write exception: catalog ingest records the manifest's provenance claims (integrity depends on catalog, so the call cannot go the other way).
   - Where the owner cannot be imported without a cycle, the caller passes a function in: `audio.processSource` takes `onReady(tx, info)`, through which the catalog records a recording's duration in the transaction that marks its source ready.
2. Authorization policy for audio access is implemented **once** in `playback.evaluatePolicy` (ADR-0016) and reused by library, dig, search result re-checks and export.
3. `catalog` never depends on `entitlement`; `entitlement` never creates anything from `catalog` physical data (COL-003 — there is no physical context in MVP at all).
4. Derived data (`search`, popularity) can always be rebuilt from canonical tables.
5. Cross-context side effects after commit flow through outbox events → jobs (ADR-0005), never through in-transaction calls into another context's tables.

## 3. Affected-context checklist for changes

When a change touches: access to audio → `playback.evaluatePolicy` tests; private data → `search` + `library` + `dig` + `export` negative tests; rights or entitlement → session revocation; schema → migration up/down test.
