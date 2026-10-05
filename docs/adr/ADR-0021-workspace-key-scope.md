# ADR-0021: Per-workspace encryption scope through envelope encryption

- Status: **Proposed**
- Date: 2026-10-05
- Deciders: product owner (pending); prepared by the tech lead
- Related: NFR-SEC-004, ADR-0004, ADR-0012, `audio_asset.encryption_key_ref`

## Context
NFR-SEC-004 asks for "at least a workspace-scoped key" for private sources and a separate key for evidence. On AWS a KMS key costs USD 1/month: one key per workspace is USD 10,000/month at 10k workspaces, and KMS limits keys per account. The first deployment (ADR-0012) encrypts every object with one customer-managed key (SSE-KMS).

## Options
1. **One KMS key per namespace class** (private, catalog, evidence) with SSE-KMS — what the first deployment does. Workspace isolation comes from authorization, not keys.
2. **Envelope encryption in the application:** one KMS key encrypts a per-workspace data key stored in the database; objects are encrypted client-side (in the worker/api) with that data key. Deleting a workspace destroys its data key (crypto-shredding), which also covers backups.
3. One KMS key per workspace — rejected on cost and quotas.

## Recommendation
Option 1 for the internal alpha (no non-team users' private uploads at scale), Option 2 before private uploads open to external users. Option 2 changes the upload path: browser uploads go through presigned PUTs that S3 encrypts, so client-side encryption needs a re-encryption step in the worker after validation (the quarantine object stays SSE-KMS, the validated original is stored encrypted with the workspace key). It also makes byte-range reads and the media gateway decrypt on the fly.

## Decision needed
Whether workspace-scoped keys are required for the internal alpha or only for external launch, and whether crypto-shredding is the deletion guarantee Legal wants (relates to Q13, RQ-01).

## Revisit trigger
Legal review of deletion guarantees; opening private uploads to external users.
