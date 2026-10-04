# UGC Policy (design draft)

- Status: Phase 8 (2026-10-04). **Draft for legal review — not in force.** Public UGC is P1 behind gate G-UGC (Q07).

## 1. MVP position
User uploads are **private only**. There is no public UGC, no public links, no sharing. Therefore notice-and-takedown for public content is not yet operational; reports on catalog metadata are accepted (`POST /v1/reports`).

## 2. Proposed policy elements for public UGC (P1)

| Element | Proposal | Needs |
|---|---|---|
| Rights statement at submission | Uploader declares rights for composition, master, samples, voices/likeness; per-territory | Legal wording |
| AI usage declaration | Per stage (composition, lyrics, vocals, instruments, mixing, mastering, artwork) | Product (Q08) |
| Review before publish | Metadata/credits completeness, duplicate/fraud checks, evidence requests | Ops staffing (Q18) |
| Distribution territories | Explicit list | — |
| Monetization | Separate from publication; seller verification first | G-SALE |
| Infringement handling | See [takedown-workflow](takedown-workflow.md) | Legal per jurisdiction |
| Repeat infringer | Strike count per account within a rolling window → upload restriction → termination; appeal | Legal (thresholds) |
| Payout hold | Only per contract/law; not forfeiture before decision (AP-12) | Legal |
| Disclaimers | Not relied on as removing service responsibility (AP-09) | Legal |

## 3. What engineering builds ahead (without enabling UGC)
- Visibility model keeps user sources `private`; a publish transition does not exist in code.
- Report intake with reason codes and rate limits.
- Audit log of operator decisions.
