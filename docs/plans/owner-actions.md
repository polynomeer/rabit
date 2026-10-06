# Owner Actions

- Status: living checklist, started 2026-10-06. Engineering keeps it current; the owner ticks items off.
- Scope: everything that needs an account, a payment method, credentials, a signature or a business/legal decision. Claude does not create accounts, enter credentials or make these decisions. Where engineering needed a stand-in to keep going, the table says which one is used.
- Product and legal questions themselves live in [open questions](../00-product/open-questions.md); this page orders them by what they unblock.

## 1. Before the first hosted deploy (staging)

| # | Action | Why it blocks | How (where prepared) | Stand-in used until then |
|---|---|---|---|---|
| O-01 | Create the AWS account(s): an Organization with `staging` and `production` accounts, IAM Identity Center sign-in, MFA on every root user, billing alerts to a team address | Nothing can be provisioned | [infra/aws/README](../../infra/aws/README.md) "What only the owner can do" | Local Docker stack (`pnpm infra:up`), `pnpm gameday`, `drill:restore`; AWS behaviour checked with mocked providers (`tofu test`) and LocalStack S3 + KMS (CI `storage-kms`) |
| O-02 | Register the domain and create its Route 53 hosted zone | Certificates and the `api.`/`media.`/`app.` hosts | `domain`, `hosted_zone_id` in `staging.tfvars` | `localhost` ports |
| O-03 | Choose the login (OIDC) provider and create the application in it | Production refuses the development issuer (T03); the web client needs a real sign-in | [ADR-0009](../adr/ADR-0009-authentication.md) lists candidates and what each needs in claim mapping; the server and web client speak standard OIDC (Authorization Code + PKCE) | Containerised mock OIDC server (`docker compose --profile oidc`, also in E2E: sign-in, token renewal, operator MFA) and the built-in dev issuer |
| O-04 | Create the OpenTofu state bucket (once per account) | `tofu init` | Commands in infra/aws/README | `tofu validate` and mock-provider tests in CI |
| O-05 | Run the first `tofu apply` for staging, then set the GitHub `staging` environment variables from `tofu output` | Deploy workflow needs the role and resource names | infra/aws/README "First deploy"; the workflow ends with `smoke.sh` post-deploy checks | `smoke.sh` is exercised in E2E against production-like instances |
| O-06 | Add protection rules to the GitHub `production` environment (required reviewers) | A production deploy must not run unreviewed | GitHub → Settings → Environments | — |
| O-07 | Approve the staging budget amount and alert addresses | Cost guard (ADR-0012: ≈ USD 220/month at alpha size) | `budget_monthly_usd`, `budget_alert_emails` | — |

## 2. Before inviting non-team testers (internal alpha)

| # | Action | Why it blocks | Prepared |
|---|---|---|---|
| O-10 | Tester notice on how personal data and uploads are handled (R6) | Testers' data may only be processed with notice | [privacy](../06-security/privacy.md) lists what is stored and logged |
| O-11 | Decide whether per-workspace encryption keys are needed for the alpha ([ADR-0021](../adr/ADR-0021-workspace-key-scope.md)) | Private uploads from people outside the team | Recommendation: one key for alpha, envelope encryption before external launch |
| O-12 | Run a manual screen-reader pass (VoiceOver/TalkBack) on the main flows | Automated checks (axe, keyboard-only) cannot judge reading order and announcements | `apps/web/e2e/a11y.spec.ts` covers the automated part |
| O-13 | Choose the alert recipients (`alert_emails`, Q18 first version) and confirm each SNS subscription email after `tofu apply` | Alerts (R8) reach no one until a subscription is confirmed | `infra/aws/observability.tf`, `infra/observability/alerts.yml`, runbooks |

## 3. Before external launch

| # | Decision or action | Open question | Notes |
|---|---|---|---|
| O-20 | Legal entity, UI language(s), minors policy | Q01 (country decided: Korea) | Korean UI catalog exists (`apps/web/src/i18n/ko.ts`) |
| O-21 | Catalog contracts and their rights (stream/preview/download/analysis) | Q02 | Rights model enforces grants per territory and use |
| O-22 | Free-tier quotas and prices, payment provider, taxes | Q03, Q04, Q05 | Quotas are configuration placeholders; payments ADR-0018 is Proposed |
| O-23 | Legal review: storing users' copies of third-party audio, removal obligations at contract end | G-LOCKER, RQ-01 | Removal API and restore reconcile exist (R10, R9) |
| O-24 | Privacy notice, retention periods, cross-border rules for analysis | Q13, DM-02 | Data stays in Seoul (ADR-0012) |
| O-25 | Supported devices and offline scope | Q06 | Web reference client only (ADR-0011) |
| O-26 | Codec ladder after a listening test | R20, ADR-0008 | Provisional AAC 160 kbps |
| O-27 | Operations staffing, on-call rotation, rights-holder response deadlines | Q18 | Runbooks and game day exist (R17) |
| O-28 | Budget ceilings (free usage, minimum guarantees, runway) | Q12 | Cost model in the hosting comparison and ADR-0012 |
| O-29 | Brand and visual design | — | Web client uses a neutral provisional style |
| O-30 | Production settings: `db_multi_az = true`, `single_nat_gateway = false`, `interface_endpoint_az_count = 2` (cost increase) | NFR-REL-008 | infra/aws variables |

## 4. Scheduled engineering items (no owner action, listed for visibility)

- Node 26 switch after its LTS date (2026-10-28), with Dependabot #2 and #7.
- Re-measure the performance baseline on an idle machine or on staging (R16).
