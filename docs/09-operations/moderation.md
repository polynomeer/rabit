# Moderation and Reports (MVP)

- Status: Phase 20 (2026-10-04). Workflow design: [takedown-workflow](../07-rights/takedown-workflow.md).

| Step | MVP mechanism |
|---|---|
| Intake | `POST /v1/reports` (reason codes: wrong_credit, wrong_relation, undisclosed_ai, spam, impersonation, rights_infringement, other); 20/hour per user; subject must exist |
| Queue | `GET /v1/ops/reports?status=received` (reporter identity not shown) |
| Triage | `received → triaged → actioned | dismissed` with reason, audited |
| Actions available | Suspend/revoke a rights grant (sessions revoked ≤ 60 s); reviewed integrity decision (e.g. `recommendation_eligibility = excluded` removes from DIG; never deletes) |
| Not automated | No report or detector score changes data by itself (TRU-008, T21) |
| Gaps (P1) | Uploader notification, appeals UI, counter-notice, repeat-infringer policy, staffing/SLAs (Q18), public UGC moderation |

Internal targets (proposal, AP-12): acknowledgement immediate, triage within 1 business day, appeal first review within 5 business days.
