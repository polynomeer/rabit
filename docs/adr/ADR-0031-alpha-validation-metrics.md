# ADR-0031: Alpha validation metrics from existing data (cohort aggregates only)

- Status: Accepted (owner decision 2026-10-24: product validation is a purpose of use, cohort aggregates only)
- Date: 2026-10-24
- Deciders: product owner, engineering
- Related: [privacy](../06-security/privacy.md), [owner actions](../plans/owner-actions.md) O-10, [mvp-scope](../01-requirements/mvp-scope.md) §0.2, ADR-0025 (listening events), validation plan (stage 3, gate C)

## Context

The invited alpha (validation experiment E4) decides whether Rabit works as a "second music app" next to an existing streaming service. Gate C asks:

- Do people come back in their fourth week without a catalog? (H4)
- Do they mix their own audio with catalog tracks? (H2)
- Does digging end in something kept? (H3)
- Do record collectors log their collections? (H5)

The data to answer this already exists: accounts, playback sessions, uploads, Audio Logs, playlists, DIG sessions, Blind Digging rounds and Physical Collection items. However, [privacy](../06-security/privacy.md) names a purpose for each. Playback sessions serve access control; listening events serve popularity and usage statements. Measuring the product is a new purpose, so it needs a decision rather than a quiet reuse.

## Options

1. **Aggregates from existing data** (chosen): add "product validation, cohort aggregates only" as a purpose; compute the gate metrics on request from the tables above; show operators counts and rates for a sign-up cohort, never a person.
2. **New product-analytics events** (client events to our API or a vendor): richer funnels, but new collection, a new processor if a vendor, consent questions and more to delete. Not needed for four gate metrics.
3. **Survey only**: no new purpose, but self-reports do not measure retention, which is the gate's main signal.

## Decision

- **Purpose added**: product validation. It covers aggregate counts and rates over a sign-up cohort. It does not cover profiles, per-person views, targeting, recommendation, or model training. Private audio is only counted (a play happened, a playlist mixes it in); its content and titles are never read (NFR-PRV-007 unchanged).
- **No new collection.** Only rows that already exist for their original purpose are read, and only the timestamps, owners and kinds needed. Existing retention and deletion rules apply unchanged; a deleted account leaves the aggregates by the next request.
- **Cohort**: accounts created between two dates (inclusive, Asia/Seoul days), status `active`. Accounts from the operator issuer (`AUTH_OPERATOR_ISSUER`, when set) are left out.
- **Activity**: a person is active on a day when they did any of these:
  - started a playback session;
  - uploaded audio or saved an Audio Log;
  - saved to the library;
  - created or edited a playlist;
  - started a DIG session or a Blind Digging round;
  - added a record to the Physical Collection.
- **Metrics**:
  - **Weekly retention** (H4): week k is days 7(k−1) to 7k−1 after the person's sign-up. It is computed for weeks 1–8 over the people whose week k has fully passed. The gate reads week 4.
  - **Mixed library** (H2): the share of people who have a playlist holding both catalog recordings and their own audio. The share of people who played their own audio at least once.
  - **Digging** (H3): DIG sessions started by the cohort; the share that ended with something kept (the session saved, or a trail step saved). The share of people who dug at least once.
  - **Collection** (H5): the share of people with at least one record and with 20 or more.
- **Small-number suppression**: any rate whose denominator is under 5 people (or 5 sessions) is returned without its count and rate (`suppressed: true`); only the denominator is shown. This keeps a single person from being read off a small cohort.
- **Access**: operators only, `GET /v1/ops/metrics/alpha`. Each view is audited (`ops.alpha_metrics_viewed`) with the cohort dates; no reason is required because nothing personal is shown.
- **Notice**: the alpha tester notice (O-10) states this purpose before anyone outside the team is invited.

## Consequences

- Gate C can be read from the operator console with no new data collected and nothing new to delete.
- "Played a playlist that mixes sources" is not measured: playback does not record which playlist it came from. The mixed-library metric is therefore "has a mixed playlist" plus "played own audio", a weaker proxy. Recording the playlist context would be new collection and needs its own decision.
- Queries run on request over a small alpha cohort. A large cohort would need precomputed aggregates (§Revisit).
- Operator accounts made with the regular issuer (development, or before the operator pool exists) count as testers.

## Revisit

- Before any audience beyond the invited alpha: whether the purpose still holds, and whether precomputed aggregates are needed.
- If a funnel needs events we do not store (screen views, playlist context): a new ADR, a privacy update and the consent model (NFR-PRV-004).
