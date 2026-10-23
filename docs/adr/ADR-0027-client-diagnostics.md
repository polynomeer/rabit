# ADR-0027: Client diagnostics (errors, crashes, hangs, web vitals)

- Status: Accepted (self-hosted, no personal data, signed-in only) / Proposed (a vendor such as Sentry may replace the storage later, see §Revisit)
- Date: 2026-10-23
- Deciders: engineering (commercial quality plan CQ-IOS-4, CQ-WEB-1)
- Related: [commercial-quality-plan](../plans/commercial-quality-plan.md), [privacy](../06-security/privacy.md), [slo](../09-operations/slo.md), ADR-0013, playback QoE reports (slo.md "Play start (client)")

## Context
We learn about a broken web page or an iOS crash only when a listener tells us. Playback QoE reports cover playback, nothing else. A paid service needs crash-free and error rates per platform and version, the stack of each distinct error, and web performance (Core Web Vitals), without sending listening history or content to a third party.

## Options
1. **Self-hosted endpoint** (chosen): clients send batches to the API; errors are grouped in our database and counted in Prometheus metrics. No new processor of personal data and no vendor account. iOS stacks stay unsymbolicated (binary image and offset) until dSYMs are uploaded somewhere (§Revisit).
2. Vendor SDK (Sentry, Crashlytics, Datadog RUM): symbolication, release health and dashboards out of the box. However, it adds a processor and a cross-border transfer (privacy notice, O-24), needs an account (owner), and SDKs collect device data by default.
3. Logs only: no grouping, no rates.

## Decision
- **Endpoint**: `POST /v1/client-diagnostics` takes one batch per call. A batch holds:
  - `platform` and `app_version`;
  - the number of app launches (iOS) or page loads (web) since the last batch;
  - up to 20 errors (`error`, `unhandled`, `crash`, `hang`), each with a repeat count;
  - web vitals: LCP, INP and CLS.
- **Signed-in only**. Errors before sign-in are not reported: an open endpoint would invite flooding, and the sign-in screens are covered by E2E. A per-user route limit applies (30 a minute).
- **No personal data**:
  - Nothing links a report to the user: no user id, no IP, no device id is stored.
  - The server scrubs messages and frames: emails, URLs' query strings and fragments, and long digit runs are replaced; Rabit ids become `<id>`.
  - Titles and other content must not be put in error messages by the clients.
- **Grouping by the server**: the fingerprint is computed on the server, never trusted from the client. It is a hash of the platform, kind, error name and the first 5 scrubbed frames.
  - Each group stores its name, message, frames, first and last seen, count, and the last app version.
  - At most 5,000 groups exist. Beyond that only existing groups are counted, and the drop is counted in a metric.
- **Retention**: groups not seen for 30 days are deleted (daily job). No per-user data exists, so account deletion has nothing to remove.
- **Metrics**:
  - `rabit_client_launches_total{platform}` and `rabit_client_errors_reported_total{platform,kind}` give the crash rate. Target: crash-free launches ≥ 99.8 %; alert `ClientCrashRateHigh` opens a ticket.
  - Web vitals histograms (`rabit_web_vitals_lcp_seconds`, `_inp_seconds`, `_cls`). Alert `WebLcpSlow` opens a ticket when p75 LCP > 2.5 s.
- **Operators** read the groups at `GET /v1/ops/client-errors`. Groups hold no personal data, so no reason is required.

## Consequences
- Crash rates and the top errors per platform and version are visible without a vendor.
- iOS crash frames need symbolication by hand (`atos` with the build's dSYM) until a symbol store exists.
- Clients must keep content out of error messages. The scrubbing is a safety net, not a licence.

## Revisit trigger
- When the team needs symbolicated iOS crashes at volume.
- When it needs session replay or tracing across clients and the API.
- Either then becomes a vendor decision for the owner (processor, privacy notice).
