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
apps/ios/             iOS client (SwiftUI, iOS 26+; see apps/ios/README.md)
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
pnpm bootstrap      # apps/server/.env with fresh local secrets, Postgres + S3, migrations, demo catalog
pnpm dev            # api + worker + media + web in one terminal; Ctrl-C stops all
```

Open http://localhost:5173, sign in with any ID, then give that account a region and a
subscription so catalog tracks play:

```bash
pnpm demo:user <ID>             # add --operator for the operator console
```

### Developer commands

| Command | What it does |
|---|---|
| `pnpm preflight` | Checks Node, pnpm, dependencies, Docker, ffmpeg/ffprobe, `.env`, the infra containers and port conflicts, with a fix for each problem |
| `pnpm bootstrap` | One-time setup (above). Safe to re-run: keeps an existing `.env` and does not ingest the catalog twice |
| `pnpm dev` | Brings infra up if needed, migrates, seeds the demo catalog if absent, runs all four processes with prefixed logs. `-- --no-web`, `-- --no-seed` |
| `pnpm status` | Containers and every service's health endpoint |
| `pnpm demo:seed` | Generates and ingests the demo catalog once (`--force` to ingest another copy; ingest is not idempotent) |
| `pnpm demo:user <ID>` | Region KR + a 30-day Listen subscription for a local account, through the operator API (needs `pnpm dev`) |
| `pnpm db:reset` | Drops and recreates the **local** `rabit` database, migrates and re-seeds. Asks for confirmation (`--yes` to skip); refuses a non-local `DATABASE_URL` |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop Postgres and S3 (`infra:down -- -v` also deletes their data) |
| `pnpm check` | lint + typecheck + build + test (CI's quality gate) |
| `pnpm e2e` | Browser tests against an isolated stack (see Quality gates) |

**Ports.** Defaults: api 8080, media 8081, web 5173, metrics 9464–9466. When another program
uses one, choose others for every command of that session:

```bash
RABIT_API_PORT=28080 RABIT_MEDIA_PORT=28081 RABIT_METRICS_PORT=29464 RABIT_WEB_PORT=5180 pnpm dev
RABIT_API_PORT=28080 RABIT_WEB_PORT=5180 pnpm demo:user alice
```

### Running pieces by hand

`pnpm dev` wraps these; they still work on their own:

```bash
cp .env.example apps/server/.env                     # then change the three secrets
pnpm infra:up                                        # Postgres :55440, S3 (SeaweedFS) :59000, buckets
pnpm db:migrate
pnpm --filter @rabit/server dev:api                  # http://localhost:8080  (control plane)
pnpm --filter @rabit/server dev:worker               # jobs, transcoding
pnpm --filter @rabit/server dev:media                # http://localhost:8081  (media gateway)
sh infra/demo/generate-catalog.sh
pnpm --filter @rabit/server catalog:ingest ../../infra/demo/out/manifest.json
pnpm --filter @rabit/web dev                         # http://localhost:5173
```

> **Upgrading from the MinIO setup (before 2026-10-05):** object storage moved to SeaweedFS (ADR-0004 amendment). Objects stored in the old MinIO volume are not migrated: run `pnpm db:reset` to re-create the dev database and catalog. The old `rabit_miniodata` volume can be removed with `docker volume rm rabit_miniodata` when no longer needed.

Catalog playback needs a license country and a subscription on the account: `pnpm demo:user <ID>` sets both through the operator API (`PUT /v1/ops/users/{id}/license-country`, `PUT /v1/ops/users/{id}/subscription`) with a dev token issued with `"operator": true`.

Health: `GET /healthz` (liveness), `GET /readyz` (database + storage). Metrics: `:9464/metrics` (api), `:9465/metrics` (worker), `:9466/metrics` (media) — internal only.

Local authentication uses the **development issuer** (ADR-0009), enabled only when `NODE_ENV != production` and `AUTH_DEV_ISSUER_ENABLED=true`:

```bash
curl -s -X POST localhost:8080/dev/token -H 'content-type: application/json' -d '{"subject":"alice"}'
```

To try the real sign-in flow (OIDC Authorization Code + PKCE) locally, start the mock provider and point the api and web client at it:

```bash
docker compose --profile oidc up -d oidc
```

It listens on port 8090 (`RABIT_OIDC_PORT` to change); the URLs below assume the default.

- api: `AUTH_DEV_ISSUER_ENABLED=false`, `AUTH_PROFILE=cognito`, `AUTH_ISSUER=http://localhost:8090/rabit`, `AUTH_JWKS_URL=http://localhost:8090/rabit/jwks`, `AUTH_AUDIENCE=rabit-web,rabit-ios`, `AUTH_OPERATOR_ISSUER=http://localhost:8090/rabit-ops`, `AUTH_OPERATOR_JWKS_URL=http://localhost:8090/rabit-ops/jwks`, `AUTH_OPERATOR_AUDIENCE=rabit-ops-web`.
- web: `VITE_OIDC_ISSUER=http://localhost:8090/rabit VITE_OIDC_CLIENT_ID=rabit-web VITE_OIDC_OPERATOR_ISSUER=http://localhost:8090/rabit-ops VITE_OIDC_OPERATOR_CLIENT_ID=rabit-ops-web pnpm --filter @rabit/web dev`.

## Troubleshooting (local)

- **Catalog tracks do not play; the media gateway answers 404 for `index.m3u8`:** the database still lists audio whose files are no longer in the local S3 (storage reset, the MinIO → SeaweedFS move, or an S3 volume removed). Run `pnpm db:reset` to rebuild the dev database and catalog together.
- **A port is already in use:** `pnpm preflight` names the program; stop it or set `RABIT_*_PORT` (see Developer commands).
- **Uploads stay "처리 중" / processing jobs time out:** if Docker ran out of memory, SeaweedFS may have been OOM-killed. It can come back with server-side copies hanging (`FILER LOCK ... no lock server found` in `docker logs rabit-s3-1`). Restart it with `docker compose restart s3`. Storage calls now fail after 30 s of silence instead of hanging, so stuck jobs retry and then reach the DLQ.
- **E2E ports in use:** set `E2E_API_PORT`, `E2E_MEDIA_PORT`, `E2E_WEB_PORT`, `E2E_METRICS_PORT`.

## Quality gates

| Command | What it checks |
|---|---|
| `pnpm lint` | ESLint (typescript-eslint strict, type-checked) + Prettier |
| `pnpm typecheck` | `tsc --noEmit` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `pnpm build` | compiled output for production |
| `pnpm test` | Vitest against real Postgres + S3 (SeaweedFS); migrations are rolled back and re-applied at start |
| `pnpm e2e` | Playwright browser tests against an isolated stack (database `rabit_e2e`, ports 18080/18081/15173, plus a mock OIDC provider in Docker on 18090 with its own api 18082 and web 15174); needs `pnpm infra:up`, Docker and ffmpeg |
| `npx @redocly/cli@1 lint docs/05-api/openapi.yaml` | OpenAPI contract |
| `pnpm audit --prod` | dependency vulnerabilities (CI) |

CI: `.github/workflows/ci.yml` (check, e2e, image build and smoke test, dependency audit). Dependency updates: Dependabot.

## Configuration

All configuration is environment variables validated at startup (`apps/server/src/platform/config.ts`); see [.env.example](.env.example). Invalid configuration aborts startup and names the variable, never its value. Secrets (`MEDIA_TOKEN_SECRET`, `CURSOR_SECRET`, S3 keys) must come from a secret store in deployed environments.

## Container image

```bash
docker build -t rabit-server .
docker run --env-file apps/server/.env rabit-server api      # or: worker | media | migrate
```
