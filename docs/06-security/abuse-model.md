# Abuse Model

- Status: Phase 7 (2026-10-04). Complements [threat-model](threat-model.md) with product-abuse scenarios.

| ID | Abuse | Actor goal | MVP exposure | Controls (MVP) | Later controls |
|---|---|---|---|---|---|
| A01 | Free storage as a piracy locker | Host commercial audio privately and share | Low — no sharing, no public links | Quota caps; private-only; export only to owner; media token bound to owner session | Legal review; fingerprint-based detection (ADR-0019) |
| A02 | Account farming for free storage | Multiply quota | Medium | Verified email via OIDC; per-account upload rate limits | Provider risk signals |
| A03 | Stream inflation to manipulate Deep Cut / popularity | Push a recording up/down tiers | Low (internal alpha) | Session-bound events; played_ms ≤ wall clock; per user/recording/day cap; distinct listeners metric | Fraud scoring (TRU-008) |
| A04 | Report flooding (takedown abuse) | Suppress catalog items | Low | Reports never auto-act; 20/hour limit; triage workflow (P1) | Reporter reputation |
| A05 | Fake relations/credits via reports | Inject misinformation | Low | Reports don't modify data; relations only via ingest with provenance | Moderated contributions (OQ-DIG-04) |
| A06 | Trail/playlist spam (public) | Promote content | None — private only | Visibility private only | Moderation policy (OQ-DIG-07) |
| A07 | Scraping catalog/credits via API | Copy dataset | Medium | Auth required; rate limits; pagination caps | Anomaly detection; licensing terms |
| A08 | Operator misuse | Free entitlements | Medium | MFA, reason, append-only audit, separation of duties later | Dual approval for bulk grants |
| A09 | Resource exhaustion via uploads | Burn transcoding CPU | Medium | Concurrent upload cap, duration cap, per-job timeouts, queue `max_pending_jobs` per workspace | Paid tiers, cost alerts |
| A10 | AI-generated mass uploads | Pollute discovery | None (no public UGC) | — | Integrity axes, rate limits, Human-first filters (P1) |
