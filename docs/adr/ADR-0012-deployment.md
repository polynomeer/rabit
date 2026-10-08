# ADR-0012: Containers on AWS Seoul, infrastructure as code in OpenTofu

- Status: **Accepted** (2026-10-05, product owner: first launch in Korea on AWS Seoul)
- Date: 2026-10-04, decided 2026-10-05
- Comparison: hosting comparison artifact (AWS Seoul, GCP Seoul, Naver Cloud, AWS + Cloudflare, Fly.io)
- Related: Playbook §9 (cost-increasing managed infrastructure), Q01 (country), Q13 (data transfer), ADR-0004, ADR-0007

## Context
Hosting choice drives cost, data residency and the worker sandbox design. These are human decisions.

## Options
1. Managed containers on a hyperscaler (AWS ECS/Fargate, GCP Cloud Run) + managed Postgres + S3/GCS + CDN
2. Kubernetes (managed) — more control, more ops
3. PaaS (Fly.io/Render) — simplest, fewer isolation controls for the worker

## Recommendation (2026-10-04, before the decision)
Option 1 in the launch country's region, with the worker as a separate service with no egress except storage and DB, IaC in Terraform/OpenTofu. Revisit once Q01 and the budget (Q12) are set.

## What is decided now
- Every process role (`api`, `worker`, `media`) builds into one OCI image with a role argument; configuration only via environment variables validated at startup; health (`/healthz`) and readiness (`/readyz`) endpoints; graceful shutdown on SIGTERM.
- Local environment: Docker Compose (Postgres, SeaweedFS S3; MinIO until 2026-10-05, ADR-0004 amendment).

## Decision (2026-10-05)
First launch is in Korea (Q01, country only) and runs on **AWS `ap-northeast-2` (Seoul)**:

| Need | Service |
|---|---|
| api, worker, media | ECS on Fargate (ARM64), one task definition per role from the same image |
| Database | RDS for PostgreSQL 16; point-in-time recovery (RPO ≤ 5 min, NFR-REL-008); Multi-AZ from external launch |
| Object storage | S3 in Seoul, the six namespaces of ADR-0004 as buckets `<env prefix>-<namespace>` |
| Encryption keys | KMS customer-managed key with rotation; S3 SSE-KMS with bucket keys (ADR-0021 for per-workspace scope) |
| Media delivery | CloudFront in front of the media role (ADR-0008); web client from S3 behind CloudFront |
| Secrets | Secrets Manager, injected as task environment (R14) |
| Sign-in | Amazon Cognito: user pool and MFA-required operator pool (ADR-0009) |
| Images | ECR, image scanning on push |
| Logs, metrics | CloudWatch Logs; Prometheus metrics scraped by Amazon Managed Prometheus or the ADOT collector (decided at deploy time) |
| IaC | **OpenTofu** (MPL-licensed fork of Terraform) in `infra/aws` |

- Network: public subnets hold only the load balancer; api and media run in private subnets with a NAT gateway (the api fetches the OIDC JWKS); the **worker runs in isolated subnets without any internet route**, reaching S3 through a gateway endpoint and ECR, logs, Secrets Manager and KMS through interface endpoints (ADR-0007).
- Data residency: all stored data stays in the Seoul region. CloudFront edges cache only short-lived media responses.
- Accounts: separate AWS accounts (or at least separate state and prefixes) for staging and production; humans use IAM Identity Center, CI deploys through GitHub OIDC with a role scoped to ECR push and ECS deploy.

## Amendment (2026-10-08): staging without a domain
The owner deploys staging before registering a domain (owner-actions O-02). With `domain` empty:
- api, media and web get CloudFront's default `*.cloudfront.net` names and certificate; no ACM certificates, no Route 53 records.
- The api gets its own CloudFront distribution: caching disabled, all viewer headers but `Host` forwarded (so `Authorization` reaches the api).
- CloudFront reaches the load balancer over **plain HTTP** on port 80. The load balancer's security group admits only CloudFront's origin-facing prefix list, and its rules forward only requests carrying the secret `x-origin-verify` header plus an `x-origin-role` header; everything else gets 404.
- Accepted risk, staging only: bearer tokens and media session tokens cross the AWS network between CloudFront and the load balancer unencrypted. Staging holds no real users' data. Production refuses an empty domain (plan-time precondition).
- Adding the domain later: set `domain` and `hosted_zone_id`, apply, update the GitHub environment variables. The web client's address changes, so Cognito callback URLs and the CSP follow from the same apply; existing staging sessions end.

## Consequences
- Alpha estimate ≈ USD 220/month: the ≈ USD 150 of the comparison plus a NAT gateway (≈ USD 43) and the worker's interface endpoints (5 × USD 0.013/h ≈ USD 47 in one zone). At 10k MAU ≈ USD 2,500/month, ~72 % of it media egress.
- Production configuration refuses `S3_SSE` other than `aws:kms` and uses the task IAM role instead of static S3 keys.
- Media egress is the cost driver; Cloudflare R2 + Workers remains the documented alternative (ADR-0008 revisit trigger).

## Revisit trigger
Media egress above USD 1,000/month; a second launch country; legal residency requirements that CloudFront edges do not meet.
