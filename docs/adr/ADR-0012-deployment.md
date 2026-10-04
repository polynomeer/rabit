# ADR-0012: Containers; cloud provider and IaC pending

- Status: **Proposed**
- Date: 2026-10-04
- Related: Playbook §9 (cost-increasing managed infrastructure), Q01 (country), Q13 (data transfer), ADR-0004, ADR-0007

## Context
Hosting choice drives cost, data residency and the worker sandbox design. These are human decisions.

## Options
1. Managed containers on a hyperscaler (AWS ECS/Fargate, GCP Cloud Run) + managed Postgres + S3/GCS + CDN
2. Kubernetes (managed) — more control, more ops
3. PaaS (Fly.io/Render) — simplest, fewer isolation controls for the worker

## Recommendation (not decided)
Option 1 in the launch country's region, with the worker as a separate service with no egress except storage and DB, IaC in Terraform/OpenTofu. Revisit once Q01 and the budget (Q12) are set.

## What is decided now
- Every process role (`api`, `worker`, `media`) builds into one OCI image with a role argument; configuration only via environment variables validated at startup; health (`/healthz`) and readiness (`/readyz`) endpoints; graceful shutdown on SIGTERM.
- Local environment: Docker Compose (Postgres, MinIO).

## Revisit trigger
Q01, Q12, Q13 decisions.
