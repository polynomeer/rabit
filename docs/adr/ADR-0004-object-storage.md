# ADR-0004: S3-compatible object storage with namespace separation

- Status: Accepted (abstraction and namespace layout; production provider Amazon S3 Seoul since 2026-10-05, ADR-0012)
- Date: 2026-10-04
- Source topic: AP ADR-15 (part)
- Related: NFR-ARCH-006, NFR-SEC-004, NFR-SEC-006, AP-06 §저장소

## Context
Originals, playback derivatives, private evidence and public artwork must be separated (AP-06). Private and catalog assets must not share a CDN namespace (AP-05). Uploads go directly from client to quarantine storage via short-lived URLs (AP-06).

## Options
1. **S3-compatible API** behind a `BlobStore` interface (AWS S3, GCS interop, Cloudflare R2, MinIO, …)
2. Provider-native SDK (vendor lock-in)
3. Local filesystem

## Decision
- Code depends only on a `BlobStore` port (put/get/head/delete/presignPut/stream). Adapter: AWS SDK v3 S3 client. Local development and tests use **SeaweedFS** (S3 gateway) in Docker. MinIO was used before 2026-10-05; see the amendment below.
- Buckets (namespaces), never mixed:
  - `rabit-quarantine` — raw uploads before validation; lifecycle expiry for abandoned objects.
  - `rabit-private-originals` — validated private originals (immutable).
  - `rabit-private-media` — private playback derivatives (HLS, waveform).
  - `rabit-catalog-originals` — licensed catalog masters (immutable).
  - `rabit-catalog-media` — catalog playback derivatives.
  - `rabit-exports` — user export archives with short lifecycle.
- Object keys are chosen by the server and are opaque (`<prefix>/<random id>/...`); a key is never an authorization token.
- Buckets are private; there is no public-read policy.
- **Production provider, regions, encryption key management (KMS) and lifecycle tiers are Proposed**: they change cost and data residency (Playbook §9, Q13 data transfer). Until decided, server-side encryption is requested on every put (`AES256`) and the decision is tracked in [open questions](../00-product/open-questions.md).

## Consequences
Per-workspace encryption keys (NFR-SEC-004) require a KMS decision; the `encryption_key_ref` column exists and records `sse-s3` until then.

## Revisit trigger
Provider selection; egress cost measurements; legal residency requirements.

## Amendment 2026-10-05: production on Amazon S3 (Seoul)
- Provider and region follow ADR-0012: Amazon S3 in `ap-northeast-2`.
- Bucket names are `<S3_BUCKET_PREFIX>-<namespace>`; the database keeps the logical namespace (`rabit-quarantine`, …) and the adapter maps it, so data does not depend on the environment.
- Every write uses SSE-KMS with a customer-managed key and bucket keys (`S3_SSE=aws:kms`, required in production); presigned uploads sign the encryption headers. Block Public Access on every bucket; bucket policies deny non-TLS access and writes without the expected key.
- Credentials come from the ECS task role; static keys are for local S3 servers only.
- Verified against LocalStack S3 + KMS with signature validation (CI job `storage-kms`): presigned uploads, server writes and copies are stored as `aws:kms` with the configured key, and a presigned upload whose encryption key header was changed is refused (403).

## Amendment 2026-10-05: local and CI object store is SeaweedFS
- **Why:** MinIO's official community images (`minio/minio`, `minio/mc`) were deleted from Docker Hub around 2026-09-12. Quay.io stopped serving anonymous pulls around 2026-09-24. The project had been archived on 2026-04-25. The first CI run failed with "pull access denied". The last free MinIO release also has an authentication bypass (CVE-2026-40344) that will not be patched in the community edition.
- **Options considered:** a third-party mirror (`pgsty/minio`; same behaviour, but third-party trust and the unpatched CVE), building MinIO from the archived source (slow CI, same CVE), SeaweedFS.
- **Decision (owner's choice):** SeaweedFS `chrislusf/seaweedfs:4.47`, the official, maintained image. Local ports are unchanged (`127.0.0.1:59000`), so configuration does not change.
- **Verified on SeaweedFS:**
  - all 157 server tests, including exact-size and SHA-256-checksum presigned PUTs (T10) and altered signed headers;
  - the browser E2E suite, including direct browser uploads;
  - SSE-S3 (`AES256`) on every put, using a dev-only key (`WEED_S3_SSE_KEY`; SeaweedFS disables SSE-S3 without one);
  - buckets and the 2-day expiry are created with `weed shell` (`infra/seaweedfs/create-buckets.sh`), with no extra client image.
- **Scope:** development and CI only. The production provider remains Proposed (above). Code depends only on the `BlobStore` port, so this choice does not leak into the application.
