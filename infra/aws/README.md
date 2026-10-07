# Rabit on AWS Seoul

Infrastructure for [ADR-0012](../../docs/adr/ADR-0012-deployment.md), written for OpenTofu ≥ 1.10. One root module per environment (`staging`, `production`), each with its own state.

| Part | Resources |
|---|---|
| Network | VPC in 2 zones; public (load balancer, NAT), private (api, media), isolated (worker, database: no internet route) subnets; S3 gateway endpoint; ECR, Logs, Secrets Manager and KMS interface endpoints |
| Compute | ECS cluster on Fargate ARM64; services `api`, `media`, `worker`; one-off task `ops` (migrations, restore reconcile) |
| Data | RDS PostgreSQL 16 (encrypted, PITR, 14-day backups, TLS only); six S3 buckets (ADR-0004) with SSE-KMS, TLS-only and key-enforcing policies, 2-day expiry on quarantine and exports |
| Sign-in | Cognito user pool (email verified, optional MFA) and operator pool (MFA required, admin-created only), hosted sign-in domains, code-flow browser clients without secrets (ADR-0009) |
| Keys, secrets | One customer-managed KMS key with yearly rotation; RDS-managed master password and generated app secrets in Secrets Manager |
| Edge | ALB with TLS 1.3 policy; CloudFront for media (origin locked by a secret header) and for the web client (S3 with origin access control); ACM certificates; Route 53 records |
| Alerts | ADOT collector next to each role → Amazon Managed Prometheus with `infra/observability/alerts.yml` → Alertmanager → SNS email (R8) |
| Governance | Monthly budget with email alerts; GitHub OIDC deploy role limited to ECR push, task definitions, the ops task, service updates and web publishing |

Security invariants are tested without an AWS account (`tests/security.tftest.hcl`, mocked providers, run in CI). They cover:
- the worker has no internet route and no public IP;
- containers are read-only and non-root, with no plain-text secrets;
- buckets block public access and use SSE-KMS with a rotating key;
- the database is private, encrypted, deletion-protected and connected with verified TLS;
- the edge uses TLS only, and the media origin is locked to CloudFront.

```bash
tofu init -backend=false && tofu test
```

Estimated cost for staging (alpha size, Seoul list prices, 2026-10): about USD 220/month. See ADR-0012.

## What only the owner can do

These need an AWS account, a domain and decisions; Claude does not create accounts or handle credentials.

1. **AWS account.** Preferably an AWS Organization with separate `staging` and `production` accounts, sign-in through IAM Identity Center, MFA on the root user.
2. **Domain.** A domain with a Route 53 hosted zone. The stack uses `api.`, `media.`, `media-origin.` and `app.` under it.
3. **Login provider: Amazon Cognito (ADR-0009, decided).** The stack creates both pools. After the first apply, create the first operator in the operator pool (no self sign-up); they set a password and enroll an authenticator app at first sign-in:
   ```bash
   aws cognito-idp admin-create-user --user-pool-id "$(tofu output -raw operator_pool_id)" \
     --username ops@example.com --user-attributes Name=email,Value=ops@example.com Name=email_verified,Value=true
   ```
   Cognito sends sign-up emails from its default sender (a low daily limit). Moving to SES with our own domain is an owner action before external launch.
4. **State bucket**, once per account:
   ```bash
   aws s3api create-bucket --bucket rabit-tfstate-<unique> --region ap-northeast-2 \
     --create-bucket-configuration LocationConstraint=ap-northeast-2
   aws s3api put-bucket-versioning --bucket rabit-tfstate-<unique> --versioning-configuration Status=Enabled
   aws s3api put-public-access-block --bucket rabit-tfstate-<unique> --public-access-block-configuration \
     BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   ```
   The state contains generated secrets: only administrators may read this bucket.

## First deploy

**Guided:** `bash infra/aws/scripts/first-deploy.sh` walks through every step below in 13 stages: tools, AWS sign-in, domain, names and recipients, state bucket, config files, plan, apply, GitHub variables, deploy, starting the services, the first operator, and alert subscriptions. It asks before every change, remembers answers in a gitignored file, and can be re-run. The manual steps follow for reference.

```bash
cd infra/aws
cp environments/staging.tfvars.example environments/staging.tfvars          # fill in
cp environments/staging.backend.hcl.example environments/staging.backend.hcl
tofu init -backend-config=environments/staging.backend.hcl
tofu plan  -var-file=environments/staging.tfvars -var api_desired_count=0 -var media_desired_count=0 -var worker_desired_count=0
tofu apply -var-file=environments/staging.tfvars -var api_desired_count=0 -var media_desired_count=0 -var worker_desired_count=0
```

The services start with zero tasks because no image exists yet. Then:

1. In GitHub, create the `staging` environment and set these variables from `tofu output`:
   - `AWS_REGION` (`ap-northeast-2`), `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY_URL`;
   - `OPS_SUBNETS` (comma-separated), `OPS_SECURITY_GROUP`;
   - `WEB_BUCKET`, `WEB_DISTRIBUTION_ID`, `API_BASE_URL` (`https://api.<domain>`);
   - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_OPERATOR_ISSUER`, `OIDC_OPERATOR_CLIENT_ID` (`tofu output oidc`; the web client's sign-in, ADR-0009);
   - `APP_URL`, `MEDIA_URL`, `MEDIA_ORIGIN_URL` (`https://app.`, `https://media.`, `https://media-origin.` under the domain) for the post-deploy checks.
2. Run the **deploy** workflow for `staging`. It builds the ARM64 image, runs migrations as the `ops` task, rolls out the services and publishes the web client.
3. Apply again without the zero counts: `tofu apply -var-file=environments/staging.tfvars`.

The workflow ends with `scripts/smoke.sh`, which checks the public addresses:
- the api is ready and requires a token, and no development issuer is reachable (T03);
- the web client sends the CSP, HSTS and frame denial;
- media works through CloudFront, and the media origin refuses requests that bypass it.

The same script runs in the E2E suite against production-like instances.

Later deploys only run the workflow. OpenTofu ignores the services' task definition revisions, so infrastructure changes and code deploys do not fight.

## Operations

- **Migrations / restore reconcile:** run the `ops` task with a command override, for example `["restore-reconcile","--dry-run"]` (see `tofu output ops_task`).
- **Before external launch:**
  - set `db_multi_az = true` and `single_nat_gateway = false`, and `interface_endpoint_az_count = 2`;
  - run `drill:restore` against a restored RDS snapshot and `pnpm gameday` scenarios against staging (R9, R17);
  - deploy the alert rules (R8).
- **Media egress** is the main cost at scale (ADR-0008). The alternative on record is Cloudflare R2 + Workers.
