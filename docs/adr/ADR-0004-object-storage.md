# ADR-0004: S3-compatible object storage with namespace separation

- Status: Accepted (abstraction and namespace layout) / **Proposed (production provider)**
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
- Code depends only on a `BlobStore` port (put/get/head/delete/presignPut/stream). Adapter: AWS SDK v3 S3 client. Local development and tests use **MinIO** in Docker.
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
