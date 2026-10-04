# Rights Model (product / technical)

- Status: Phase 8 (2026-10-04). **This is not legal advice and draws no legal conclusions.** Each row is classified as **Implementable** (no contract or legal opinion needed to build the mechanism), **Contract required**, or **Legal review required** before it may be enabled for users.
- Data model: [ADR-0016](../adr/ADR-0016-rights-and-entitlement.md), [domain-model](../04-data/domain-model.md).

## 1. Content classes

| Class | Who holds rights | How Rabit may use it | Access rule | MVP status | Classification |
|---|---|---|---|---|---|
| Licensed catalog (stream) | Labels/publishers/distributors | Only uses in active RightsGrant (territory, period) | Grant(stream) ∧ Entitlement(play) at access time | Structure built; content = self-made fixtures | Mechanism **Implementable**; real catalog **Contract required** (Q02) |
| Purchased digital album | Same as catalog + purchase terms | Per Offer snapshot capabilities | Entitlement(origin=purchase) ∧ Grant covering sale terms | Entitlement origin exists; no sales | **Contract required** (Q04/Q05); consumer law **Legal** |
| User-created private audio | Uploader (presumed; never inferred) | Store, transcode, play to owner, export to owner | Owner workspace only | ✅ | Mechanism Implementable; private cloud storage of user content **Legal review** for ToS |
| Third-party audio uploaded privately | Third party | Same technical treatment; no sharing | Owner only | ✅ (indistinguishable technically) | **Legal review required** (AP-09: 개인 오디오 클라우드) |
| Audio Log (voice recordings) | Recorder; other voices have personality/privacy rights | Owner only; analysis opt-in (P2) | Owner only | ✅ | Implementable; consent guidance text **Legal** |
| Public UGC (Studio release) | Uploader + any underlying rights holders | Only after review and rights statement | Visibility public after approval | ❌ (P1) | **Legal review required** (Q07) + takedown workflow |
| Commercial release by creator | Creator/label | Per seller agreement | Offers | ❌ (P1) | **Contract required** |
| Physical collection record | Owner of the object (physical) | Metadata record only | Owner only | ❌ (P1) | Implementable (record only); edition DB license **Contract** |
| User-local CD rip (private locker) | Rights holders; private copying exceptions vary | Possibly private source if legal | Owner only | ❌ blocked (`cd_rip` origin not creatable) | **Legal review required** (Q11) |
| Platform Master Unlock / Digital Upgrade | Rights holder offering it | Only via rights-holder Offer per edition | Entitlement from upgrade Offer | ❌ (P2) | **Contract required** + Legal |
| Lyrics, transcripts of catalog, artwork | Separate rights | Display only if licensed | Separate grants | ❌ | **Contract required** |
| Credits / relations data (DIG) | Data supplier / editorial | Display with provenance | Public metadata | Self-made fixtures only | **Contract required** for supplier data (OQ-DIG-06) |
| ML analysis / training on catalog | Rights holders | Only with `analysis` use in grant; training separate | Grant(analysis) | ❌ | **Contract required** (CAT-009) |

## 2. Rules encoded in the system

1. **Possession is not ownership**: uploading a file never creates a catalog link, entitlement or rights claim (CLAUDE.md).
2. **Physical ≠ digital**: no code path from physical records to entitlements (COL-003). Local Rip + Private Locker and Platform Master Unlock are separate features with separate gates.
3. **Fingerprint ≠ ownership**: a match (P2) is only a candidate signal, never a final copyright determination and never a reason to give catalog access.
4. **Relation ≠ license**: DIG shows "samples X" with `license_status` as a separate field (`unknown` by default).
5. **Access-time checks**: rights are re-evaluated at session issue and refresh; revocation propagates ≤ 60 s for new media requests.
6. **No cross-user dedup** of private uploads (ADR-0014).
7. **Test content**: only self-generated audio and fictional metadata in fixtures (CAT-008).

## 3. Rights operations in MVP

| Operation | Path | Audit |
|---|---|---|
| Create grant | `POST /v1/ops/rights-grants` (operator + MFA + reason) or fixture ingest | ✅ |
| Suspend / revoke / reactivate grant | `POST /v1/ops/rights-grants/{id}/status` | ✅ + `RightsGrantChanged` → session revocation |
| Expire grant | scheduled job | ✅ (system actor) |

## 4. Gates summary

| Gate | Blocks | Decision owner |
|---|---|---|
| G-CAT | Any real catalog content | Rights (Q02) |
| G-SALE | Purchases, downloads | Finance/Legal (Q04, Q05) |
| G-UGC | Public Studio releases | Product/Rights/Legal (Q07) |
| G-LOCKER | Legal basis for private storage of third-party audio; ToS | Legal |
| G-CD | CD rips, matching, upgrades | Legal/Rights (Q11) |
| G-DATA | Credits/relations supplier data | Rights (OQ-DIG-06) |
