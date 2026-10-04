# ADR-0017: Internal provenance claim schema; C2PA later

- Status: Accepted (internal schema) / **Proposed (C2PA adoption)**
- Date: 2026-10-04
- Source topic: AP ADR-07
- Related: TRU-001..005, TRU-011, DIG-018, CNF-07, CNF-08

## Decision
- `provenance_claim`: `subject` (recording / release / audio version), `claim_type` (`creation_method`, `credit`, `relation`, `rights_statement`), `stage` (composition, lyrics, vocals, instruments, mixing, mastering, artwork) for creation-method claims, `value`, `issuer` (account / distributor / platform), `evidence_ref`, `verification_state`, `basis` (`declared | verified_fact | ml_inferred`), `created_at`.
- `verification_state` stores the **union** of the two source vocabularies so no product meaning is lost while CNF-07 is open: `self_declared`, `distributor_verified`, `signature_valid`, `process_evidence_reviewed`, `rights_reviewed`. Display labels are decided by product (CNF-07/08).
- No "Human Verified" badge is computed in MVP. The criteria are a human decision (Q08, Playbook §9).
- `basis = ml_inferred` values are never shown as facts and never shown with a numeric score as a verdict (PB Phase 16).
- C2PA manifest ingestion/verification for audio is Proposed until a spec version and audio format support are tested.

## Revisit trigger
CNF-07/08, Q08 decisions; C2PA audio support maturity.
