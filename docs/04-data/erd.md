# ERD and Persistence Model

- Status: Phase 5 (2026-10-04). Domain: [domain-model](domain-model.md). Database: PostgreSQL 16 (ADR-0003).
- Migrations live in `apps/server/src/platform/db/migrations/` and are authoritative; this document must be updated in the same commit as any migration.
- Implemented so far: `0001_platform` (job, outbox_event, audit_log, idempotency_record), `0002_identity`, `0003_audio`, `0004_playback`, `0005_audio_log`, `0006_catalog_entitlement`, `0007_library`, `0008_dig`, `0009_search`, `0010_integrity`, `0011_rate_limit`, `0012_physical_collection`, `0013_blind_dig`.

## 1. Conventions

| Topic | Rule |
|---|---|
| IDs | `text` primary keys `<prefix>_<ULID>` with `CHECK (id ~ '^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$')` (ADR-0015) |
| Timestamps | `timestamptz NOT NULL DEFAULT now()`; `created_at` on all tables, `updated_at` on mutable tables (set by application) |
| States | `text` + `CHECK (state IN (...))`, mirrored by TS union types |
| Money | `bigint amount_minor` + `char(3) currency` (P1 tables only) |
| Soft delete | Only where a tombstone is semantically required: `audio_source.deleted_at`, `app_user.deletion_requested_at`. Other deletes are hard deletes inside retention policy. |
| JSON | `jsonb` only for opaque technical metadata and event payloads, never for fields used in authorization |
| Optimistic locking | `version integer NOT NULL DEFAULT 1` on playlist, rights_grant, entitlement, subscription |
| Binary audio | Never in DB (NFR-DATA-010) |

### ID prefixes

| Prefix | Table | Prefix | Table |
|---|---|---|---|
| `usr` | app_user | `rgt` | rights_grant |
| `wsp` | workspace | `sub` | subscription |
| `upl` | upload_session | `enl` | entitlement |
| `aob` | audio_object | `pbs` | playback_session |
| `aov` | audio_version | `lib` | library_item |
| `asr` | audio_source | `pls` | playlist |
| `ast` | audio_asset | `pli` | playlist_item |
| `alg` | audio_log | `exp` | export_request |
| `art` `per` `lbl` `rel` `rec` | music_entity (by type) | `dgs` | dig_session |
| `crd` | credit | `dgn` | dig_trail_node |
| `mrl` | music_relation | `prc` | provenance_claim |
| `isg` | integrity_signal | `rpt` | report |
| `adl` | audit_log | `job` | job |
| `evt` | outbox_event | `lev` | listening_event |

## 2. Tables

### identity
```text
app_user(id PK, oidc_issuer, oidc_subject, email_verified bool, status CHECK(active|deletion_requested|deleted),
         license_country char(2) NULL, created_at, updated_at, deletion_requested_at NULL)
  UNIQUE(oidc_issuer, oidc_subject)
-- Quota policies are configuration (QUOTA_FREE_* env, Q03 placeholders), not a table:
-- workspace.quota_policy_id names the policy ('free_default').
workspace(id PK, type CHECK(personal|studio|catalog), owner_user_id FK app_user NULL, quota_policy_id text, created_at)
  CHECK((type='catalog') = (owner_user_id IS NULL))
  UNIQUE(owner_user_id) WHERE type='personal'
  UNIQUE(type) WHERE type='catalog'
membership(workspace_id FK, user_id FK, role CHECK(owner|publisher|editor|viewer), created_at, PK(workspace_id,user_id))
  INDEX(user_id)
```

### audio
```text
upload_session(id PK, workspace_id FK, created_by FK app_user, intent CHECK(private_upload|audio_log),
               declared_bytes bigint CHECK>0, declared_sha256 char(64), declared_content_type text NULL,
               default_title text NULL,   -- sanitized from the untrusted filename; cleared on deletion
               quarantine_key text UNIQUE, state CHECK(created|uploading|quarantined|processing|ready|failed|cancelled|expired),
               reserved_bytes bigint, expires_at, failure_code NULL, audio_source_id FK NULL,
               created_at, updated_at)   -- finalize idempotency lives in idempotency_record
  INDEX(workspace_id, state)   INDEX(state, expires_at) WHERE state='created'
audio_object(id PK, kind CHECK(recording|private_audio|audio_log), current_version_id NULL, created_at)
audio_version(id PK, audio_object_id FK, version_no int, recording_id FK music_entity NULL, content_sha256 char(64),
              duration_ms bigint NULL, technical jsonb NOT NULL DEFAULT '{}', created_at)
  UNIQUE(audio_object_id, version_no)
audio_source(id PK, audio_version_id FK, workspace_id FK, origin CHECK(catalog|private_upload|audio_log),
             visibility CHECK(private|public), status CHECK(processing|ready|failed|deleting|deleted),
             title text NULL, created_by FK app_user NULL, failure_code NULL, storage_prefix text UNIQUE,
             deleted_at NULL, created_at, updated_at)
  CHECK((origin='catalog') = (visibility='public'))
  CHECK((status IN ('deleting','deleted')) = (deleted_at IS NOT NULL))
  INDEX(workspace_id, status, created_at DESC, id)
  INDEX(audio_version_id)
audio_asset(id PK, audio_source_id FK, kind CHECK(original|hls|waveform), bucket text, object_key text,
            sha256 char(64) NULL, bytes bigint, codec text NULL, tool_version text NULL,
            encryption_key_ref text NOT NULL, created_at)
  UNIQUE(bucket, object_key)   UNIQUE(audio_source_id, kind)
audio_log(id PK, audio_source_id FK UNIQUE, author_user_id FK, title text, note text NULL,
          recorded_at timestamptz, recorded_tz text, linked_recording_id FK music_entity NULL,
          tags text[] NOT NULL DEFAULT '{}', created_at, updated_at)
```
- `audio_object.current_version_id` FK added after `audio_version` exists (deferrable).
- Bucket/namespace match is enforced in the repository layer and by `CHECK (bucket LIKE 'rabit-catalog-%' OR bucket LIKE 'rabit-private-%')` plus a test; a cross-table check (source origin vs bucket) is enforced in code because it spans tables.

### catalog
```text
music_entity(id PK, entity_type CHECK(artist|person|label|release|recording), display_name, sort_name,
             search_tsv tsvector GENERATED, created_at, updated_at)
  CHECK(prefix matches entity_type)   INDEX GIN(search_tsv)   INDEX GIN(display_name gin_trgm_ops)
recording(id PK FK music_entity, title, isrc text NULL UNIQUE, duration_ms bigint NULL,
          catalog_audio_source_id FK audio_source NULL UNIQUE)
recording_artist(recording_id FK, artist_id FK music_entity, ord int, PK(recording_id, artist_id))
release(id PK FK music_entity, title, release_type CHECK(album|single|ep|compilation), label_id FK music_entity NULL,
        release_date date NULL, upc text NULL UNIQUE)
release_artist(release_id FK, artist_id FK, ord int, PK(release_id, artist_id))
release_track(release_id FK, disc_no int DEFAULT 1, position int, recording_id FK, PK(release_id, disc_no, position))
  INDEX(recording_id)
credit(id PK, subject_entity_id FK music_entity, contributor_entity_id FK music_entity,
       role CHECK(composer|lyricist|producer|engineer|mixing_engineer|mastering_engineer|performer|featured_artist|arranger),
       instrument text NULL, creation_method CHECK(human|ai_assisted|ai_generated|unknown),
       basis CHECK(verified_fact|declared|ml_inferred), verification_state CHECK(...union...), source text,
       evidence_ref text NULL, created_at)
  UNIQUE(subject_entity_id, contributor_entity_id, role, coalesce(instrument,''))
  INDEX(contributor_entity_id, role)   INDEX(subject_entity_id)
music_relation(id PK, from_entity_id FK, to_entity_id FK, relation_type CHECK(samples|covers|remix_of|influenced_by|member_of|signed_to),
               basis, confidence numeric(4,3) NULL, verification_state, source text, evidence_ref NULL,
               license_status CHECK(unknown|licensed|not_applicable), valid_from date NULL, valid_to date NULL, created_at)
  CHECK(from_entity_id <> to_entity_id)
  CHECK(basis <> 'ml_inferred' OR (confidence > 0 AND confidence <= 1))
  CHECK(basis <> 'verified_fact' OR verification_state <> 'self_declared')
  UNIQUE(from_entity_id, to_entity_id, relation_type, source)
  INDEX(from_entity_id, relation_type)   INDEX(to_entity_id, relation_type)
rights_grant(id PK, recording_id FK, rights_holder text, territories text[] , uses text[],
             valid_from timestamptz, valid_to timestamptz NULL, status CHECK(active|suspended|revoked|expired),
             contract_ref text, version int, created_at, updated_at)
  CHECK(uses <@ ARRAY['stream','download','preview','transform','stem','analysis'])
  INDEX(recording_id, status)
```

### entitlement
```text
subscription(id PK, user_id FK, plan text, state CHECK(active|past_due|cancelled|expired), paid_through timestamptz,
             source CHECK(operator|sandbox), version int, created_at, updated_at)
  UNIQUE(user_id) WHERE state IN ('active','past_due')
entitlement(id PK, user_id FK, scope CHECK(catalog_all|release|recording), resource_id FK music_entity NULL,
            capabilities text[], origin CHECK(subscription|purchase|grant), origin_ref text,
            valid_from, valid_to NULL, status CHECK(active|suspended|revoked|expired), version int, created_at, updated_at)
  CHECK((scope='catalog_all') = (resource_id IS NULL))
  INDEX(user_id, status)
```

### playback
```text
playback_session(id PK, user_id FK, audio_source_id FK, capability, device_id text, status CHECK(active|expired|revoked),
                 issued_at, expires_at, rights_version int NULL, entitlement_version int NULL,
                 rights_grant_id NULL, entitlement_id NULL, refreshed_count int, revoked_reason NULL)
  INDEX(audio_source_id) WHERE status='active'   INDEX(user_id, issued_at DESC)
  INDEX(rights_grant_id) WHERE status='active'   INDEX(entitlement_id) WHERE status='active'
listening_event(id PK, session_id FK, user_id FK, recording_id NULL, client_event_id uuid, sequence int,
                type CHECK(started|heartbeat|seek|paused|ended), position_ms bigint, played_ms bigint,
                client_time timestamptz, received_at timestamptz, accepted bool, reject_reason NULL)
  UNIQUE(session_id, client_event_id)   INDEX(recording_id, received_at) WHERE accepted
recording_popularity(recording_id PK FK, window_days int, distinct_listeners int, plays int,
                     percentile numeric(5,4) NULL, tier CHECK(top|upper|deep_cut|obscure|unknown),
                     policy_version text, computed_at)
```
- `listening_event` is range-partitioned by `received_at` (monthly) once volume warrants (AP-05); MVP uses a single table with the same columns so partitioning is a non-breaking change. Raw events retained 90 days (NFR-PRV-005, proposal).

### library
```text
library_item(id PK, user_id FK, ref_type CHECK(audio_source|recording|release), ref_id text, origin CHECK(uploaded|logged|saved),
             note NULL, saved_at)
  UNIQUE(user_id, ref_type, ref_id)   INDEX(user_id, saved_at DESC, id)
playlist(id PK, owner_user_id FK, title, description NULL, visibility CHECK(private), version int, created_at, updated_at)
  INDEX(owner_user_id, updated_at DESC)
playlist_item(id PK, playlist_id FK ON DELETE CASCADE, rank int, ref_type CHECK(audio_source|recording), ref_id text, added_at)
  UNIQUE(playlist_id, rank) DEFERRABLE INITIALLY DEFERRED
export_request(id PK, user_id FK, state CHECK(requested|building|ready|expired|failed), include_originals bool,
               object_key NULL, bytes NULL, expires_at NULL, failure_code NULL, created_at, updated_at)
```
- `ref_id` is polymorphic **with** a validated `ref_type`; integrity is checked by the library service on write and items whose target vanished resolve to `availability: deleted` — they never fail open (AP-05 forbids unvalidated polymorphic links for money/rights; library refs carry no rights).

### dig
```text
dig_session(id PK, user_id FK, start_entity_id FK music_entity, state CHECK(active|ended), title NULL, saved bool,
            visibility CHECK(private), current_seq int, started_at, ended_at NULL)
  INDEX(user_id, started_at DESC)
dig_trail_node(id PK, session_id FK ON DELETE CASCADE, seq int, parent_seq int NULL, entity_id FK music_entity,
               via_axis text NULL, via_relation_id FK NULL, via_credit_id FK NULL, via_basis NULL,
               played bool, saved bool, created_at)
  UNIQUE(session_id, seq)
```

### integrity
```text
provenance_claim(id PK, subject_entity_id FK, claim_type CHECK(creation_method|rights_statement), stage NULL CHECK(composition|lyrics|vocals|instruments|mixing|mastering|artwork),
                 value text, issuer text, basis, verification_state, evidence_ref NULL, created_at)
  INDEX(subject_entity_id)
integrity_signal(id PK, subject_entity_id FK, axis CHECK(ai_generation|technical_quality|spam_risk|rights_status|recommendation_eligibility),
                 value text, basis CHECK(declared|automated|reviewed), internal_score numeric NULL, model_version NULL, created_at)
  INDEX(subject_entity_id, axis)
report(id PK, reporter_user_id FK, subject_type CHECK(recording|release|artist|relation|credit), subject_id text,
       reason_code CHECK(wrong_credit|wrong_relation|undisclosed_ai|spam|impersonation|rights_infringement|other),
       details text NULL (≤2000), status CHECK(received|triaged|actioned|dismissed), created_at, updated_at)
  INDEX(status, created_at)
```

### ops
```text
job(id PK, kind, payload jsonb, dedupe_key text UNIQUE, status CHECK(queued|running|succeeded|failed|dead),
    attempts int, max_attempts int, run_after, locked_by NULL, locked_until NULL, last_error text NULL,
    correlation_id text NULL, created_at, updated_at)
  INDEX(status, run_after) WHERE status='queued'   INDEX(locked_until) WHERE status='running'
outbox_event(id PK, type, schema_version int, subject_id, workspace_id NULL, privacy_scope, correlation_id NULL,
             occurred_at, payload jsonb, dispatched_at NULL)
  INDEX(occurred_at) WHERE dispatched_at IS NULL
audit_log(id PK, actor_type CHECK(user|operator|system), actor_id NULL, action, subject_type, subject_id,
          reason NULL, correlation_id NULL, details jsonb, at)
  INDEX(subject_type, subject_id, at)
search_document(id text PK  -- = subject id, doc_kind CHECK(recording|release|artist|person|label|private_audio|audio_log),
                owner_workspace_id FK NULL, visibility CHECK(private|public), title, subtitle NULL,
                tsv tsvector, norm text, updated_at)
  CHECK((visibility='private') = (owner_workspace_id IS NOT NULL))
  INDEX GIN(tsv)  INDEX GIN(norm gin_trgm_ops)  INDEX(owner_workspace_id)
```
- `audit_log` is append-only: a `BEFORE UPDATE OR DELETE` trigger raises an exception (works regardless of which role the application uses).
- `idempotency_record(user_id, operation, idempotency_key) PK, request_hash, response_status, response_body jsonb, created_at` stores Idempotency-Key results (api-guidelines §5).

### physical_item (`0012_physical_collection`, P1, COL-001/002/007)
| Column | Type | Notes |
|---|---|---|
| id | `phy_…` | |
| user_id | FK app_user | owner; every query is scoped to it (404 for others) |
| format | `cd \| vinyl \| cassette \| other` | |
| title, artist_name | text ≤ 300 | user-entered |
| barcode | text `^[0-9]{8,14}$` | API also checks the GTIN check digit |
| catalog_number | text ≤ 100 | |
| release_id | FK release, `ON DELETE SET NULL` | the edition the owner says this copy is; not an identification (COL-004 is M2) |
| notes | text ≤ 2000 | personal data |
| verification_state | `self_declared \| evidence_reviewed` | owner cannot write it; evidence review is M2 (COL-008) |
| created_at, updated_at | timestamptz | index `(user_id, created_at DESC, id DESC)` |

No foreign key, trigger or code path connects `physical_item` to entitlement data (COL-003); `collection.test.ts` asserts the constraint and trigger set and that the module never imports entitlement or playback code.

### blind_dig, blind_dig_item (`0013_blind_dig`, DIG-010)
- `blind_dig`: `bld_…`, user_id FK app_user, start_entity_id FK music_entity (`ON DELETE SET NULL`), popularity filter, created_at; index `(user_id, created_at DESC)`.
- `blind_dig_item`: `bli_…`, blind_dig_id FK (`ON DELETE CASCADE`), recording_id FK recording, position, decision `keep|pass` NULL, decided_at; `decision` and `decided_at` are set together; unique per round on position and on recording.

## 3. Storage and authorization boundary

| Data | Where | Who can read | Path |
|---|---|---|---|
| Private originals | `rabit-private-originals` | owner via export only; worker | never directly; export archive presigned GET ≤ 15 min |
| Private HLS/waveform | `rabit-private-media` | media gateway after token + session check | `/media/v1/s/{token}/…` |
| Catalog masters | `rabit-catalog-originals` | worker only | never exposed |
| Catalog HLS | `rabit-catalog-media` | media gateway after token + session check | same as above |
| Quarantine | `rabit-quarantine` | client PUT via presigned URL (one key, size, expiry); worker read | never GET for clients |
| Exports | `rabit-exports` | requesting user via short presigned GET | `GET /v1/exports/{id}` returns link |

Object keys: `<asr id>/<random>/<asset kind>…` (`audio_source.storage_prefix`, chosen at source creation) — the random component prevents guessing; keys are still not authorization (NFR-SEC-006).

## 4. Retention (proposals; legal periods are Legal items)

| Data | Retention | Mechanism |
|---|---|---|
| Quarantine objects | until processed, or 24 h after expiry | expire job + bucket lifecycle |
| Private originals/derivatives | while source not deleted | deletion job, tombstone |
| `listening_event` | 90 days raw | partition drop / purge job |
| `playback_session` | 90 days after expiry, once no listening events reference it | `playback.purge_sessions` |
| `audit_log` | Legal (not fixed) | none in MVP |
| Exports | 24 h after ready | expire job |
| `job` succeeded rows | 14 days | purge job |

## 5. Migration and rollback strategy

1. Every migration has `up` and `down`. CI runs `up → down → up` from empty on each change.
2. Production changes follow **expand → migrate code → contract**. A contract step (drop column/table, tighten constraint on populated data) is a **destructive migration** and needs explicit human approval (Playbook §6/§9). It is written as a separate migration file flagged in its header comment `-- DESTRUCTIVE`.
3. Old and new app versions must run concurrently against the expanded schema.
4. Index builds on large tables use `CREATE INDEX CONCURRENTLY` in their own non-transactional migration.
5. Backfills run as jobs, not in migrations.
6. `down` of an expand migration may drop new columns (data loss only of data written by the new version); this is documented per migration.

## 6. Schema review (pre-migration)

| Check | Result |
|---|---|
| AudioObject, AudioAsset, Entitlement, RightsGrant, Visibility, Provenance are separate tables/columns with no implicit coupling | ✅ |
| Private vs catalog namespace enforced (CHECK origin↔visibility, bucket prefix check, repository rule) | ✅ (cross-table part in code + test) |
| No FK/trigger path from any physical/collection data to entitlement | ✅ `physical_item` references only `app_user` and `release`; no triggers (tested) |
| Client-controlled ownership impossible (owner columns set only from principal) | ✅ (API layer; tested) |
| Idempotency: `job.dedupe_key`, `listening_event(session_id, client_event_id)`, upload finalize key | ✅ |
| Playlist ordering under concurrency: version + deferred unique rank | ✅ |
| Tombstones for deletion races | ✅ `audio_source.deleted_at`, checked by jobs |
| Polymorphic refs | Only in library/search (no rights/money); validated `ref_type` |
| Money | Not present in MVP schema (P1) |
| Exact location | No location columns exist (LOC-003) |
| PII minimization | No email/name stored (token claims are not persisted beyond issuer/subject/email_verified) |
