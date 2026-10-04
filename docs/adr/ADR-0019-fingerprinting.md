# ADR-0019: Audio fingerprinting and edition identification

- Status: **Proposed**
- Date: 2026-10-04
- Source topic: AP ADR-10
- Related: AUD-016, COL-004, R01

## Context
Fingerprints support duplicate/merge candidates and edition identification. Options are licensing an external service/database vs self-built (e.g. Chromaprint). External edition databases have usage-license implications (AP-09).

## MVP position
Only SHA-256 content hashes are computed (integrity and same-workspace hints). No acoustic fingerprint in MVP; the pipeline has a no-op `fingerprint` step so it can be added without changing the job graph.

## Revisit trigger
P2 Collection/edition work; spam near-duplicate detection needs (TRU-008).
