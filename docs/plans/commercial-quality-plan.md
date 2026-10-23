# Commercial Quality Plan

- Status: plan, 2026-10-23. Engineering keeps it current; owners tick off decisions in [owner-actions](owner-actions.md).
- Purpose: everything still needed to take Rabit from a working, tested personal-project build to a product that can be sold to listeners in Korea and accepted by rights holders. It builds on the [release-readiness audit](release-readiness.md) (R-numbers) and the open questions (Q-numbers); it does not repeat what those already close.
- Item ids are `CQ-<area>-<n>`. Each item has:
  - **Priority**:
    - **P0**: blocks the commercial launch;
    - **P1**: expected of a paid service at launch;
    - **P2**: after launch.
  - **Who**:
    - **Eng**: engineering alone;
    - **Owner**: needs an account, contract, signature or business decision;
    - **Both**: engineering can prepare, an owner decides or signs.
  - **Needs**: what must exist first.

## 1. Where we stand

Done and covered by CI (details in release-readiness and the ADRs):
- **Product flows** (P0): private uploads, Audio Log, library, playlists, entitlements, the DIG modes, search, the Passport, reports and the operator console.
- **Audio**:
  - transcoder pool on ECS with autoscaling;
  - gapless edit lists and loudness gain (-14 LUFS);
  - an AAC-LC ladder at 96, 160 and 256 kbps;
  - an edge token check with a shared segment cache;
  - next-track preload;
  - client QoE reports with alerts.
- **Commerce**: album purchase and a monthly subscription against a sandbox provider, App Store subscriptions on iOS, and monthly usage statements (ADR-0025).
- **Play queue and autoplay** on the account, on web and iOS (ADR-0026).
- **Infrastructure and quality**: AWS Seoul in OpenTofu, alerts, runbooks, a local game day and restore drill, E2E and accessibility checks.

What none of the above gives yet:
- real catalog or real money;
- a hosted environment;
- people on call;
- the client polish listeners compare against Melon, Genie, FLO, YouTube Music and Spotify.

## 2. Content supply and rights

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-CAT-1 | **Catalog contracts** (distributors or labels) with the stream, preview, download and analysis rights per territory (Q02, O-21) | P0 | Owner | Legal entity (O-20) |
| CQ-CAT-2 | **DDEX ERN 4.x ingest**: parse deliveries (new release, update, takedown), validate them against the supplier's delivery spec, map them to recordings, releases, rights grants and artwork, and send acknowledgements. Must be idempotent and replayable, with a per-delivery audit trail and a quarantine for malformed deliveries | P0 | Eng | Supplier spec (CQ-CAT-1); today `infra/demo/catalog/*.json` is the only ingest |
| CQ-CAT-3 | **Supplier takedowns and rights end dates** enforced within the edge revocation window (≤ 60 s, ADR-0008 amendment), with stale entitlements revoked and the change shown in the library | P0 | Eng | CQ-CAT-2 |
| CQ-CAT-4 | **Real artwork pipeline**: ingest, validate (size, colour space), derive several sizes and serve them from the CDN. Clients still draw stand-in covers from a hash | P0 | Eng | CQ-CAT-2 |
| CQ-CAT-5 | **Metadata quality checks**: ISRC and UPC format and duplicates, artist identity merging (aliases, Korean and romanized names), credits roles, release dates, explicit flags. Include an operator queue for conflicts | P1 | Eng | CQ-CAT-2 |
| CQ-CAT-6 | **Usage reporting in the formats each party requires**: DDEX DSR or their template, and reporting to the Korean collecting societies (KOMCA, KOSCAP, FKMP, RIAK) and the chart (Circle Chart). The rate allocation follows the music transmission tariff (음원 전송사용료 징수규정). ADR-0025 statements are the source | P0 | Both | CQ-CAT-1; O-21a |
| CQ-CAT-7 | **Lyrics**: a licensed lyrics source, synced (LRC) where available, shown in Now Playing on both clients | P1 | Both | Lyrics licence |
| CQ-CAT-8 | **Editorial tooling**: curated shelves and playlists on Home, with scheduling and per-territory visibility. Home today is generated from the catalog | P1 | Eng | — |

## 3. Playback and audio quality

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-PLY-1 | **DRM** where contracts require it: FairPlay Streaming on iOS and Safari, Widevine on Chrome, Edge and Android. Needs a key server or a multi-DRM vendor, licence renewal tied to the existing session refresh, and an ADR (change to ADR-0008) | P0 if contracts require it | Both | CQ-CAT-1; Apple FPS credentials |
| CQ-PLY-2 | **Listening test of the ladder** (96/160/256 kbps) before the bitrates stop being provisional (R20, O-26) | P0 | Both | — |
| CQ-PLY-3 | **Lossless (FLAC or ALAC in fMP4)** as a premium rendition, with a quality picker for Wi-Fi and cellular and an honest quality badge | P1 | Eng | Lossless masters in CQ-CAT-1; price tier (Q04) |
| CQ-PLY-4 | **Offline downloads on iOS**: encrypted storage, licence expiry and an offline grace period, a re-check on reconnect, storage management, and downloads removed when rights end (Q05, Q06) | P1 | Both | CQ-PLY-1 for catalog content |
| CQ-PLY-5 | **Device integration on iOS**: AirPlay route picker, CarPlay (needs Apple's CarPlay audio entitlement), interruption and route-change handling (calls, unplugged headphones), lock-screen artwork from real covers | P1 | Eng | CQ-CAT-4; CarPlay entitlement (Owner) |
| CQ-PLY-6 | **Web playback hardening**: Safari native HLS path, background tabs, the Media Session API on every browser, behaviour when the audio device changes | P1 | Eng | — |
| CQ-PLY-7 | **Crossfade and an equalizer** as optional settings that leave gapless albums untouched | P2 | Eng | — |
| CQ-PLY-8 | **Playback QoE targets on real devices**: measure startup p95, rebuffering and errors (slo.md) on staging, on LTE and on weak Wi-Fi; then tune the prepare-next window and ABR start rung | P1 | Eng | Staging (CQ-OPS-1) |

## 4. Clients

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-IOS-1 | **Run the app on devices**: Xcode on a development Mac (O-40) and the Developer Program (O-41). Today the app has only been compiled and unit-tested in CI | P0 | Owner | — |
| CQ-IOS-2 | **TestFlight and a release pipeline**: signing in CI, build numbers, release notes, phased release and an App Review checklist (demo account, O-45) | P0 | Both | CQ-IOS-1 |
| CQ-IOS-3 | **iOS UI tests** (XCUITest) for sign-in, play, queue, purchase (StoreKit testing) and delete account, run in the `ios` workflow; make `ios` a required check | P1 | Eng | — |
| CQ-IOS-4 | **Crash and hang reporting** with MetricKit (diagnostics to our backend) or a vendor, with symbol upload and a crash-free-sessions target (≥ 99.8 %) | P0 | Eng | Vendor choice if not self-hosted (Owner) |
| CQ-IOS-5 | **VoiceOver, Dynamic Type and Reduce Motion pass** on every screen (O-12 covers the web) | P1 | Eng | CQ-IOS-1 |
| CQ-IOS-6 | **App Intents (Siri, Shortcuts), widgets and Handoff** of the current track between devices (the queue already lives on the account) | P2 | Eng | — |
| CQ-WEB-1 | **Web error and performance monitoring**: client error reports (no personal data), Core Web Vitals, and bundle-size budgets in CI | P0 | Eng | — |
| CQ-WEB-2 | **Public share pages** for release, track and playlist links: server-rendered Open Graph and Twitter cards, safe with private content (a private item never gets a public page) | P1 | Eng | — |
| CQ-WEB-3 | **PWA**: service worker for the app shell (never caching media or private API responses), install prompt, offline page | P2 | Eng | — |
| CQ-WEB-4 | **English UI** next to Korean (the i18n layer exists; only `ko.ts` is filled in), if O-20 includes English | P2 | Both | O-20 |
| CQ-AND-1 | **Android client** (Q06, O-25). Korean market share makes this close to required for a paid service; needs an ADR (native Kotlin or cross-platform) | P1 | Both | Q06 decision |

## 5. Discovery and search

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-SRC-1 | **Korean search quality**: initial-consonant search (ㄴㅇㅂ → 뉴진스), romanized and Korean name aliases, typo tolerance, and a judged query set with a relevance score checked in CI | P0 | Eng | Real catalog for the query set |
| CQ-SRC-2 | **Autocomplete and recent searches** (recent searches only on the device or account, deletable) | P1 | Eng | — |
| CQ-SRC-3 | **Search at catalog scale**: measure p95 at millions of recordings; decide between Postgres trigram and full-text and a dedicated engine (OpenSearch) in an ADR-0006 revisit | P1 | Eng | CQ-CAT-2 |
| CQ-DSC-1 | **Autoplay quality evaluation**: offline metrics per reason tier (coverage, how many seeds run dry, artist diversity) and listener feedback (skip, keep). The ADR-0026 revisit trigger | P1 | Eng | Real catalog |
| CQ-DSC-2 | **Personalisation ADR**: whether listening history may shape suggestions, with an opt-in, retention and explainability (DSC-004/005, Q13) | P2 | Both | Owner decision |

## 6. Commerce and money

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-COM-1 | **Payment provider** for the web (for example Toss Payments, NICEPAY or KG Inicis), with recurring billing by billing key, webhook signature and replay checks, and refunds (O-22, ADR-0018) | P0 | Both | Contract with the provider; merchant registration |
| CQ-COM-2 | **Consumer law flows**: the withdrawal right (청약철회) and its exclusions shown before purchase, receipts, cash receipts (현금영수증), cancellation in as many steps as sign-up, and a notice before a renewal price change | P0 | Both | Legal review |
| CQ-COM-3 | **Subscription lifecycle**: retry and grace period, dunning messages, pause, family or student plans if priced | P1 | Both | Q04 |
| CQ-COM-4 | **App Store reconciliation**: App Store Server API for transaction history and lookups, and a daily diff against our entitlements (architecture review follow-up) | P1 | Both | App Store Connect API key (Owner) |
| CQ-COM-5 | **Finance exports**: monthly revenue, VAT, commission and refund reports that tie out with the ledger; zero-mismatch alert (NFR-REL-007) | P0 | Eng | CQ-COM-1 |
| CQ-COM-6 | **Royalty settlement runs** from usage statements to amounts owed per licensor, with an approval step and an audit trail | P1 | Eng | CQ-CAT-6; contract rates |

## 7. Reliability, scale and cost

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-OPS-1 | **Staging on AWS**: finish the first deploy (O-01..O-08), then the hosted restore drill (R9) and game day (R17) | P0 | Both | AWS sign-in by the owner |
| CQ-OPS-2 | **Production environment**: Multi-AZ database, NAT per AZ, endpoints in two AZs (O-30), protected deploys (O-06), and our own domain with SES email (O-02, O-31) | P0 | Both | CQ-OPS-1 |
| CQ-OPS-3 | **Load test at launch size**: API, playback session start, media edge and transcoder throughput at a target such as 10× expected peak; then capacity and autoscaling limits written down (R16) | P0 | Eng | CQ-OPS-1 |
| CQ-OPS-4 | **Database connection pooling** (RDS Proxy or PgBouncer) and query budgets, before autoscaling multiplies connections | P1 | Both | Cost approval |
| CQ-OPS-5 | **Media CDN signed URLs or cookies** in place of the shared token check, if the revocation trade-off is accepted (ADR-0008 change) | P1 | Both | Owner decision |
| CQ-OPS-6 | **Disaster recovery**: cross-region backup copies and a written RTO/RPO for a Seoul region outage | P1 | Both | Q12 budget |
| CQ-OPS-7 | **Cost dashboards per unit**: cost per stream hour, per transcoded hour and per active user, with budget alerts per component | P1 | Eng | CQ-OPS-1 |

## 8. Security

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-SEC-1 | **External penetration test** of the API, media edge, web and iOS before launch; fix and re-test High findings | P0 | Owner | Staging |
| CQ-SEC-2 | **WAF and bot protection** on CloudFront: managed rules, rate rules on sign-up, sign-in and playback start, and stream-ripping and credential-stuffing patterns | P0 | Eng | CQ-OPS-1 |
| CQ-SEC-3 | **Account security for listeners**: optional MFA in the user pool, new-device sign-in notice, session list with remote sign-out, concurrent stream limit per subscription | P1 | Eng | Product decision on the stream limit |
| CQ-SEC-4 | **Supply chain**: SBOM and signed images, deploy only signed digests, secret rotation schedule | P1 | Eng | — |
| CQ-SEC-5 | **ISMS-P readiness**: map the controls; certification becomes mandatory above the legal revenue or user thresholds | P1 | Both | Owner decision on timing |
| CQ-SEC-6 | **Vulnerability disclosure policy** (security.txt, a contact address) and later a bug bounty | P1 | Owner | — |

## 9. Privacy and legal (Korea)

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-LEG-1 | **Terms of service and a privacy policy** under PIPA, with the processor list (AWS, Cognito, payment provider), retention periods and cross-border transfer disclosure (O-24) | P0 | Owner | Legal review |
| CQ-LEG-2 | **Business registrations**: mail-order business (통신판매업) and value-added telecommunications business (부가통신사업), plus the business information in the footer and the app | P0 | Owner | Legal entity |
| CQ-LEG-3 | **Explicit content and age verification**: carry the explicit or 19+ flag from deliveries, verify age through identity verification (본인인증) before 19+ tracks play, and add a minors policy (Q01) | P0 | Both | Identity verification provider contract |
| CQ-LEG-4 | **Consent for under-14s** (guardian consent) or a minimum age at sign-up (Q01) | P0 | Both | Q01 |
| CQ-LEG-5 | **Accessibility conformance** with KWCAG 2.2 for the web and app (anti-discrimination law); add a conformance statement | P1 | Eng | O-12, CQ-IOS-5 |
| CQ-LEG-6 | **Takedown and notice process for rights holders**: response deadlines, counter-notice and repeat-infringer policy for private uploads (R11, Q18) | P0 | Both | Q18 |

## 10. Operations and support

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-SUP-1 | **On-call rotation and paging** (beyond email alerts): escalation, incident roles, post-incident reviews (Q18, O-13, O-27) | P0 | Owner | Staffing |
| CQ-SUP-2 | **Status page** and in-app incident banners | P1 | Eng | CQ-OPS-2 |
| CQ-SUP-3 | **Customer support channel**: help centre and FAQ (payments, refunds, playback), a contact form that attaches the support id, and response targets | P0 | Both | Staffing |
| CQ-SUP-4 | **Operator console for support**: refund and grant actions with reasons, subscription history, playback error history per user (metadata only, OPS-007) | P1 | Eng | CQ-COM-1 |
| CQ-SUP-5 | **Dashboards** for the SLO journeys (slo.md) and the business health numbers (sign-ups, conversions, churn, plays) | P1 | Eng | CQ-OPS-1 |

## 11. Product analytics and release engineering

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-ANA-1 | **Privacy-preserving product analytics**: an event schema, consent handling, no personal content in events, funnels for sign-up, first play, conversion and retention | P1 | Both | CQ-LEG-1 |
| CQ-ANA-2 | **Feature flags** with gradual rollout and a kill switch per feature (R12), on the server and both clients | P1 | Eng | — |
| CQ-REL-1 | **Release process**: versioning and changelog, staged web deploys with automatic rollback on SLO burn, a mobile release train, and forced-upgrade support for incompatible iOS builds | P1 | Eng | CQ-OPS-2, CQ-IOS-2 |
| CQ-REL-2 | **Device and browser test matrix**: iOS versions and devices, Safari, Chrome and Samsung Internet, plus a slow-network profile in E2E | P1 | Eng | — |

## 12. Design and brand

| Id | Item | Priority | Who | Needs |
|---|---|---|---|---|
| CQ-DES-1 | **Brand and visual identity**: name check, logo, app icon, typography (O-29) | P0 | Owner | — |
| CQ-DES-2 | **Design pass on both clients** with the brand: onboarding (taste pick without listening-based ranking), empty states, error copy, a consistent design system between web and iOS | P1 | Both | CQ-DES-1 |
| CQ-DES-3 | **App Store and marketing assets**: screenshots, preview video, store copy and keywords in Korean | P0 | Both | CQ-DES-1, CQ-IOS-2 |

## 13. Suggested order

1. **Now: engineering only, no decision needed**
   - CQ-IOS-4 crash reporting and CQ-WEB-1 error and performance monitoring.
   - CQ-SRC-1 Korean search (initial-consonant search and aliases with a judged query set built on the demo catalog).
   - CQ-CAT-8 editorial tooling and CQ-ANA-2 feature flags.
   - CQ-IOS-3 UI tests, CQ-PLY-6 web playback hardening, CQ-WEB-2 share pages.
   - CQ-CAT-2 and CQ-CAT-4 DDEX ingest and the artwork pipeline, against public ERN samples, until a supplier spec arrives.
2. **When the owner signs in to AWS**:
   - CQ-OPS-1 staging, then CQ-OPS-3 load test, CQ-PLY-8 QoE on real networks, CQ-SEC-2 WAF and CQ-SUP-5 dashboards.
   - Then CQ-SEC-1 pen test.
3. **After the legal entity and contracts**:
   - CQ-CAT-1, CQ-CAT-6 and CQ-PLY-1 DRM (if contracts require it).
   - CQ-COM-1 and CQ-COM-2 payments.
   - CQ-LEG-1 to CQ-LEG-4 legal.
   - CQ-OPS-2 production.
4. **Launch candidates**:
   - CQ-IOS-2 TestFlight, CQ-DES-3 store assets.
   - CQ-SUP-1 and CQ-SUP-3 support and on-call.
   - A final readiness audit that updates release-readiness target B.

## 14. Decisions this plan needs from the owner

Grouped by what they unblock:
- **Catalog and audio**: contracts and delivery spec (Q02), DRM requirement, lossless tier, lyrics licence.
- **Money**: payment provider and prices (Q04), refund and withdrawal policy (Q05), App Store Connect API key.
- **Company and law**: legal entity, registrations, terms and privacy policy, minors and age verification (Q01), takedown deadlines and staffing (Q18).
- **Platforms**: Android and offline scope (Q06), Xcode and the Apple Developer Program (O-40, O-41).
- **Infrastructure**: AWS sign-in for staging, production cost settings (O-30), DR budget (Q12), media CDN signing trade-off.
- **Brand** (O-29).
