# Domain Model

- Status: Phase 4 (2026-10-04). Language and invariants first; persistence in [erd.md](erd.md).
- Contexts: [domain-boundaries](../03-architecture/domain-boundaries.md). Decisions: ADR-0014, ADR-0016, ADR-0017.

## 1. Distinctions that must hold (PB Phase 4 gate)

| Pair | Distinction in this model |
|---|---|
| AudioObject vs AudioAsset | AudioObject = logical playable/analysable thing with versions. AudioAsset = stored bytes (original, HLS package, waveform). An object has zero or more assets *per source*; deleting an asset never deletes the object's history. |
| Track vs Recording vs Release/Album | **Recording** = a specific performance (ISRC). **Release** = album/single as published; **Edition** = a concrete variant of a release. **ReleaseTrack** = position of a recording in an edition. "Track" is the UI word for a ReleaseTrack (or a Recording when shown outside a release). There is no separate Track aggregate (resolves CNF-11). |
| Ownership vs Access vs Subscription Entitlement | Ownership of user content = the workspace that owns the AudioSource. Access = result of the playback policy at request time. Entitlement = a record granting capabilities on a catalog resource (origin subscription/purchase/grant). None implies another. |
| UserUpload vs CatalogAsset | AudioSource.origin `private_upload`/`audio_log` live in a user workspace and private buckets; origin `catalog` lives in the system catalog workspace and catalog buckets. |
| Visibility | `private` (owner workspace only) and `public` (catalog, readable metadata). `unlisted` and `release` are **reserved** — product decision CNF-10. User sources are always `private` in MVP. Visibility is never changed by upload success (STU-002). |
| RightsClaim vs Provenance | RightsGrant = licensed uses/territories/period from a rights holder. ProvenanceClaim = who made what and how, with evidence. A provenance relation (e.g. "samples X") says nothing about license (DIG-018 `license_status` is a separate field). |
| Verified fact vs ML inference | Every relation, credit and claim has `basis ∈ {verified_fact, declared, ml_inferred}`. `ml_inferred` is never displayed as fact. |
| Purchase vs LibraryItem | Purchase (P1) creates an Entitlement; LibraryItem is the user's organizational record. Removing a library item never revokes an entitlement; revoking an entitlement never deletes the library item (it becomes unavailable). |
| Physical ownership vs Digital entitlement | No physical model in MVP; when added (P1), no code path may derive an Entitlement from a PhysicalItem (COL-003). |
| Artist identity vs uploader account | Artist/Person are catalog MusicEntities. A user account/workspace is never an artist identity; claiming an artist identity is a future verified process (P1, impersonation risk). |

## 2. Shared value objects

| Value object | Rules |
|---|---|
| `Id<T>` | Prefixed opaque ID (ADR-0015). Parsed and branded at boundaries. |
| `Instant` | UTC timestamp. Paired with `TimeZoneName` (IANA) where local time matters (LOG-005). |
| `DurationMs` | Non-negative integer milliseconds. |
| `TimeRange` | `0 ≤ start_ms < end_ms ≤ duration_ms`. |
| `Sha256` | 64 lowercase hex chars. |
| `ByteSize` | Non-negative integer. |
| `Territory` | ISO 3166-1 alpha-2, or `WORLD` in grants only. |
| `Money` | `{amount_minor: bigint, currency: ISO 4217}` (P1). |
| `Capability` | `play | download_export | download_purchase | offline | transform | stems | analyze | publish` |
| `Basis` | `verified_fact | declared | ml_inferred` |
| `VerificationState` | `self_declared | distributor_verified | signature_valid | process_evidence_reviewed | rights_reviewed` (union, ADR-0017) |
| `CreationMethod` | `human | ai_assisted | ai_generated | unknown` |
| `PopularityTier` | `top | upper | deep_cut | obscure | unknown` (DIG-007, spec §6.3) |

## 3. Aggregates by context

### 3.1 identity

**User** — `id, oidc_issuer, oidc_subject, status, license_country?, created_at, deletion_requested_at?`
- Invariants: `(issuer, subject)` unique. `license_country` is set only by server policy/operator (never from client). A `deletion_requested` user cannot start new uploads, sessions or exports.
- States: `active → deletion_requested → deleted`. Forbidden: `deleted → *`, `deletion_requested → active` (MVP: no undo after the job starts).

**Workspace** — `id, type (personal|studio|catalog), owner_user_id?, quota_policy_id`
- Exactly one `personal` workspace per user, created with the user. `catalog` is a single system workspace with no human owner.

**Membership** — `(workspace_id, user_id) unique, role (owner|publisher|editor|viewer)`.

**QuotaPolicy** — `max_total_bytes, max_file_bytes, max_duration_ms, max_concurrent_uploads, max_pending_jobs`. Values are configuration (Q03); the mechanism is enforced server-side (ACC-004).

### 3.2 audio

**UploadSession** — `id, workspace_id, created_by, intent (private_upload|audio_log), declared_bytes, declared_sha256, declared_content_type (untrusted, informational), quarantine_key, state, reserved_bytes, expires_at, failure_code?, audio_source_id?`

```text
created ──finalize(verified size+hash)──▶ quarantined ──worker claims──▶ processing ──▶ ready
   │                                         │                              └──▶ failed
   ├──cancel──▶ cancelled                    └──validation fails──▶ failed
   └──expires_at passes──▶ expired
```
- `uploading` (AP-03) is reserved for server-tracked multipart uploads (P1); single-PUT uploads go `created → quarantined`.
- Forbidden: any transition out of `ready|failed|cancelled|expired`; `finalize` when not `created` (a repeated finalize with the same Idempotency-Key returns the original result; with a different key returns 409).
- Invariants: reserved bytes count against quota until terminal state; quota check and reservation happen atomically at intent creation (AUD-009 quota race). Server chooses `quarantine_key`.

**AudioObject** — `id, kind (recording|private_audio|audio_log), current_version_id, created_at`
- `kind` is about what it *is*; access is decided by AudioSource.

**AudioVersion** — immutable: `id, audio_object_id, version_no, recording_id?, content_sha256, duration_ms, technical (sample_rate, channels, codec, container, integrated_lufs, true_peak_dbtp)`.
- Invariant: `version_no` increases by 1 per object; never updated after creation.

**AudioSource** — `id, audio_version_id, workspace_id, origin (catalog|private_upload|audio_log|cd_rip*), visibility, status, title?, created_by?, deleted_at?`
- `cd_rip` reserved, not creatable (COL-005 Legal).
- States: `processing → ready | failed`; `ready|failed → deleting → deleted`. Forbidden: `deleted → *`; `deleting → ready`.
- Invariants: origin `catalog` ⇔ workspace type `catalog` ⇔ visibility `public`. Origins `private_upload|audio_log` ⇒ visibility `private`. A tombstone (`deleted_at`) is checked by every job before writing derivatives (LIB-008).

**AudioAsset** — `id, audio_source_id, kind (original|hls|waveform), bucket, object_key, sha256?, bytes, codec?, tool_version?, encryption_key_ref`
- Bucket must match source namespace (private ↔ `rabit-private-*`, catalog ↔ `rabit-catalog-*`) — NFR-ARCH-006.

**AudioLog** — `id, audio_source_id (unique), author_user_id, title, note?, recorded_at, recorded_tz, linked_recording_id?, tags[]`
- An AudioLog is an AudioObject of kind `audio_log` plus this metadata (LOG-001). Editing `recorded_at` never alters the version/provenance (LOG-005).

### 3.3 catalog

**MusicEntity registry** — `id, entity_type (artist|person|label|release|recording), display_name, sort_name, created_at`. Every catalog node used by DIG has a registry row, so relations have referential integrity (AP-05, resolves CNF-12). Scene/place/work types are reserved (P2).

**Recording** — `id (=entity id), title, isrc?, duration_ms, primary_artist_ids[], catalog_audio_source_id?`
**Release** — `id, title, release_type (album|single|ep|compilation), label_id?, release_date?, upc?`
**ReleaseTrack** — `(release_id, disc_no, position) unique → recording_id`. MVP uses one edition per release; Edition is reserved.

**Credit** — `id, subject_entity_id (recording|release), contributor_entity_id (person|artist), role, instrument?, creation_method, basis, verification_state, source, evidence_ref?`
- Roles (MVP): `composer, lyricist, producer, engineer, mixing_engineer, mastering_engineer, performer, featured_artist, arranger`.

**MusicRelation** — `id, from_entity_id, to_entity_id, relation_type, basis, confidence?, verification_state, source, evidence_ref?, license_status, valid_from?, valid_to?`
- `relation_type` (MVP stored edges): `samples, covers, remix_of, influenced_by, member_of, signed_to`.
- Derived (not stored) axes: `same_producer`, `session_musicians`, `same_label`, `credited_on` — computed from Credit/Release (DIG-006).
- Invariants: `from ≠ to`; `basis = ml_inferred ⇒ confidence ∈ (0,1]`; `basis = verified_fact ⇒ verification_state ≠ self_declared`; `license_status ∈ {unknown, licensed, not_applicable}` independent of the relation (DIG-018).

**RightsGrant** — see ADR-0016. States: `active ⇄ suspended`, `active|suspended → revoked`, `active → expired` (time). Forbidden: `revoked → *`. Every change bumps `version` and emits `RightsGrantChanged`.

### 3.4 entitlement

**Subscription** — `id, user_id, plan, state (active|past_due|cancelled|expired), paid_through, source (operator|sandbox)`. P1 adds provider refs.
**Entitlement** — ADR-0016. States: `active ⇄ suspended`, `active|suspended → revoked|expired`. Forbidden: `revoked → *`. Subscription entitlements (`scope=catalog_all`) follow the subscription state. Cancelling a subscription never touches `origin=purchase|grant` entitlements (COM-009).

### 3.5 playback

**PlaybackSession** — `id, user_id, audio_source_id, capability, device_id, status (active|expired|revoked), issued_at, expires_at, rights_version?, entitlement_version?, refreshed_count`
- Issued only after policy allows. Refresh re-runs the policy; denial revokes the session. Forbidden: `revoked|expired → active`.

**ListeningEvent** — `(session_id, client_event_id) unique, sequence, type (started|heartbeat|seek|paused|ended), position_ms, played_ms, client_time, received_at, accepted, reject_reason?`
- Server validates: session owned by caller, `position_ms ≤ duration`, `played_ms` bounded by wall time since previous event. Duplicates are ignored, out-of-order accepted by sequence.

**RecordingPopularity** (derived) — `recording_id, distinct_listeners_window, plays_window, window_days, percentile, tier, computed_at, policy_version`.

### 3.6 library

**LibraryItem** — `id, user_id, ref (audio_source_id | recording_id | release_id), origin (uploaded|logged|saved|purchased*), note?, saved_at`. Unique per (user, ref).
**Playlist** — `id, owner_user_id, title, description?, visibility (private), version, created_at, updated_at`; items `PlaylistItem {id, playlist_id, rank, ref (audio_source_id | recording_id), added_at}`.
- Items never store file URLs or asset keys (PB Phase 13).
- Every mutation requires the current `version` (ETag/If-Match) and increments it; stale writes get 412 (concurrent edit).
- Availability of each item is computed at read/play time by `playback.evaluatePolicy`; unavailable/deleted items stay with `availability` reason (`deleted`, `rights_unavailable`, `subscription_required`, `not_found`).
- A playlist owner can add only sources they can access; adding a private source never grants anyone else access (LIB-004).

**Export** — `id, user_id, state (requested|building|ready|expired|failed), scope, object_key?, expires_at?`. Includes only the user's own originals + metadata (catalog originals never — LIB-006).

### 3.7 dig

**DigSession** — `id, user_id, start_entity_id, state (active|ended), title?, saved (bool), visibility (private), started_at, ended_at?`
**DigTrailNode** — `id, session_id, seq, parent_seq?, entity_id, via (axis, relation_id?|credit_id?, basis), played, saved, created_at`.
- Invariants: `seq` strictly increasing; a node's `via` must reference a relation/credit that actually connects the parent entity to this entity at the time of the step (server-verified — clients cannot fabricate edges). Returning to a previous node appends nothing; it moves the cursor (`current_seq`).
- Starting from a private AudioSource with no catalog recording link gives an empty state with guidance (DIG-025).

### 3.8 integrity

**ProvenanceClaim** — ADR-0017.
**IntegritySignal** — `id, subject_entity_id, axis (ai_generation|technical_quality|spam_risk|rights_status|recommendation_eligibility), value, basis (declared|automated|reviewed), internal_score?, model_version?, created_at`. Axes are independent (TRU-007). `internal_score` never leaves the API.
**Report** — `id, reporter_user_id, subject_ref, reason_code, details?, status (received|triaged|actioned|dismissed), created_at`. User reports are distinct from automated signals (TRU-009).
**Music Passport** — read model: creation method per stage, credits, provenance claims with verification state and basis, rights review scope summary, dispute/report link.

### 3.9 ops

**AuditLog** — append-only: `id, actor (user|operator|system), action, subject_type, subject_id, reason?, correlation_id, at, details (no PII)`. Required for rights, entitlement, subscription, deletion and operator actions.
**AccountDeletion** — `user_id, state (requested|in_progress|completed)`.
**Job / OutboxEvent** — ADR-0005.

## 4. Cross-aggregate invariants

1. No AudioAsset in a catalog bucket belongs to a non-catalog source, and vice versa.
2. A private AudioSource is visible only to members of its workspace — in lists, search, DIG starts, playlists, exports and playback.
3. Playback = policy(source, principal, capability, now) — never cached beyond the media token lifetime.
4. Deleting a source: status `deleting`, tombstone set, sessions revoked, library/playlist refs become `deleted` availability, search docs removed, assets deleted by job; completion `deleted`.
5. RightsGrant or Entitlement change ⇒ sessions issued under older versions are revoked.
6. Ledger/financial invariants are P1 (ADR-0018).

## 5. Open questions found while modelling (not resolved here)

| Ref | Question | Owner |
|---|---|---|
| CNF-10 | Is `unlisted` a product visibility? Does `release` become a visibility or a publishing state? | Product |
| DM-01 | Should private uploads be linkable to a catalog Recording (e.g. "this is my live recording of X")? Model allows `recording_id` on AudioVersion only for catalog in MVP. | Product |
| DM-02 | Account deletion grace period (undo window) | Product / Legal (retention) |
| DM-03 | Free-tier quota values | Q03 |
| DM-04 | Does a DIG session started from an Audio Log linked to a recording count as a DIG start from that recording? (MVP: yes, via `linked_recording_id`) | Product (confirm) |

These are added to [open-questions](../00-product/open-questions.md).
