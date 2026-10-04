# Rabit

Audio platform integrating Listen / Own / Create / Collect / Remember / Trust / **Dig**.

- Engineering rules: [CLAUDE.md](CLAUDE.md) · Commit convention: [CONTRIBUTING.md](CONTRIBUTING.md)
- Product: [PRD](docs/01-requirements/prd.md) · [MVP scope](docs/01-requirements/mvp-scope.md) · [Roadmap](docs/plans/roadmap.md) · [Open questions](docs/00-product/open-questions.md)
- Architecture: [System context](docs/03-architecture/system-context.md) · [ADRs](docs/adr/README.md) · [Domain model](docs/04-data/domain-model.md) · [ERD](docs/04-data/erd.md) · [API](docs/05-api/openapi.yaml)
- Source planning documents (kept verbatim): `audio-platform/`, `*.docx`

## Repository layout

```text
apps/server/          TypeScript modular monolith (api | worker | media roles)
  src/platform/       config, db + migrations, http, jobs/outbox, storage, logging, metrics
  src/modules/        bounded contexts (identity, audio, playback, catalog, library, dig, ...)
  src/app/            composition root
  src/entry/          process entry points
  test/               integration and unit tests (real Postgres + S3 via SeaweedFS)
apps/web/             web reference client
infra/                local infrastructure init scripts
docs/                 product, architecture, API, security, rights, ADRs
```

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 24 LTS (`.nvmrc`; 22.12+ works) |
| pnpm | 11 (`corepack enable` picks the pinned version) |
| Docker | with Compose v2 |
| ffmpeg / ffprobe | 6+ on `PATH` (worker and tests) |

## Run from a clean clone

```bash
corepack enable
pnpm install
pnpm infra:up                           # Postgres :55440, S3 (SeaweedFS) :59000, buckets
cp .env.example apps/server/.env
pnpm db:migrate
pnpm check                              # lint + typecheck + build + test
```

> **Upgrading from the MinIO setup (before 2026-10-05):** object storage moved to SeaweedFS (ADR-0004 amendment). Objects stored in the old MinIO volume are not migrated. Re-create local data with `pnpm infra:up`, then reset the dev database (`pnpm --filter @rabit/server migrate:down` repeatedly, or drop the `rabit` database) and re-run the demo catalog ingest. The old `rabit_miniodata` volume can be removed with `docker volume rm rabit_miniodata` when no longer needed.

Start the three process roles (separate terminals):

```bash
pnpm --filter @rabit/server dev:api      # http://localhost:8080  (control plane)
pnpm --filter @rabit/server dev:worker   # jobs, transcoding
pnpm --filter @rabit/server dev:media    # http://localhost:8081  (media gateway)
```

Web reference client (ADR-0011) and a fictional demo catalog (self-made tones):

```bash
sh infra/demo/generate-catalog.sh
pnpm --filter @rabit/server catalog:ingest ../../infra/demo/out/manifest.json
pnpm --filter @rabit/web dev             # http://localhost:5173
```

Catalog playback needs a license country and a subscription on the account; set them with the operator API (`PUT /v1/ops/users/{id}/license-country`, `PUT /v1/ops/users/{id}/subscription`) using a dev token issued with `"operator": true`.

Health: `GET /healthz` (liveness), `GET /readyz` (database + storage). Metrics: `:9464/metrics` (api), `:9465/metrics` (worker), `:9466/metrics` (media) — internal only.

Local authentication uses the **development issuer** (ADR-0009), enabled only when `NODE_ENV != production` and `AUTH_DEV_ISSUER_ENABLED=true`:

```bash
curl -s -X POST localhost:8080/dev/token -H 'content-type: application/json' -d '{"subject":"alice"}'
```

## Quality gates

| Command | What it checks |
|---|---|
| `pnpm lint` | ESLint (typescript-eslint strict, type-checked) + Prettier |
| `pnpm typecheck` | `tsc --noEmit` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `pnpm build` | compiled output for production |
| `pnpm test` | Vitest against real Postgres + S3 (SeaweedFS); migrations are rolled back and re-applied at start |
| `pnpm e2e` | Playwright browser tests against an isolated stack (database `rabit_e2e`, ports 18080/18081/15173); needs `pnpm infra:up` and ffmpeg |
| `npx @redocly/cli@1 lint docs/05-api/openapi.yaml` | OpenAPI contract |
| `pnpm audit --prod` | dependency vulnerabilities (CI) |

CI: `.github/workflows/ci.yml`. Dependency updates: Dependabot.

## Configuration

All configuration is environment variables validated at startup (`apps/server/src/platform/config.ts`); see [.env.example](.env.example). Invalid configuration aborts startup and names the variable, never its value. Secrets (`MEDIA_TOKEN_SECRET`, `CURSOR_SECRET`, S3 keys) must come from a secret store in deployed environments.

## Container image

```bash
docker build -t rabit-server .
docker run --env-file apps/server/.env rabit-server api      # or: worker | media | migrate
```
