# CD Import Risk

- Status: Phase 8 (2026-10-04). Gate G-CD (Q11). **No CD features in MVP.** Update 2026-10-07: the *physical record* row is implemented (manual registration, `self_declared`, no evidence images yet); every other row is unchanged.

## 1. Feature split (must stay separate)

| Feature | What it is | Risk | Classification |
|---|---|---|---|
| Physical record | User records that they own a CD/vinyl (metadata, optional evidence) | Low; evidence images are personal data | Implementable (P1) |
| Edition matching | TOC/fingerprint/metadata → edition candidates with confidence | Wrong match; edition DB license | Implementable mechanism; **data license Contract** |
| Local Rip + Private Locker | User rips locally and uploads as private source (`cd_rip`) | Private copying exceptions vary by jurisdiction; service-side copying/transmission liability; TPM circumvention | **Legal review required** |
| Matched master (serve Rabit's master for a CD the user owns) | Platform delivers licensed master | Requires rights-holder permission; would be a new distribution | **Contract required** |
| Digital Upgrade | Rights-holder Offer tied to an edition (discount, hi-res, bonus) | Contract terms, reuse/transfer of proof, fraud | **Contract required** + Legal |

## 2. Invariants (already enforced)
- `cd_rip` origin exists in the domain vocabulary but cannot be created (no API, DB CHECK excludes it from MVP).
- No entitlement can be created from physical data: `physical_item` has no FK, trigger or code path to entitlement data, and registering a release does not change its playability (`collection.test.ts`).
- Fingerprint equality with catalog never grants catalog playback.

## 3. Checklist carried from AP-09 (all open)
- [ ] Jurisdictional review of private ripping and cloud copy/transmission responsibility
- [ ] TPM / copy-protection circumvention review
- [ ] Whether matching converts into master delivery
- [ ] Family sharing, global dedup, cross-border access
- [ ] Resale/loss of physical item vs digital rights
- [ ] Edition database and cover image licenses
