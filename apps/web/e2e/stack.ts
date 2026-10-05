/**
 * Starts an isolated Rabit stack for browser E2E tests and keeps it running
 * until Playwright stops it:
 *   fresh `rabit_e2e` database → migrations → demo catalog (self-made tones)
 *   → worker, api, media → catalog processed → web client.
 * Ports differ from the dev servers so both can run at once. Logs go to
 * e2e-results/stack.log. Run directly with Node (built-in type stripping).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { E2E } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const server = resolve(root, 'apps/server');
const web = resolve(root, 'apps/web');
const tsx = resolve(server, 'node_modules/.bin/tsx');
const manifest = resolve(root, 'infra/demo/out/manifest.json');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  API_PORT: String(E2E.apiPort),
  MEDIA_PORT: String(E2E.mediaPort),
  METRICS_PORT: String(E2E.metricsPort),
  API_PUBLIC_BASE_URL: E2E.apiUrl,
  MEDIA_PUBLIC_BASE_URL: E2E.mediaUrl,
  CORS_ALLOWED_ORIGINS: E2E.webUrl,
  DATABASE_URL: E2E.databaseUrl,
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:59000',
  S3_PUBLIC_ENDPOINT: process.env['S3_PUBLIC_ENDPOINT'] ?? 'http://127.0.0.1:59000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'rabit',
  S3_SECRET_ACCESS_KEY: 'rabit-dev-secret',
  S3_FORCE_PATH_STYLE: 'true',
  AUTH_ISSUER: `${E2E.apiUrl}/dev`,
  AUTH_AUDIENCE: 'rabit-api',
  AUTH_JWKS_URL: '',
  AUTH_DEV_ISSUER_ENABLED: 'true',
  MEDIA_TOKEN_SECRET: 'e2e-only-media-token-secret-0123456789abcdef',
  CURSOR_SECRET: 'e2e-only-cursor-secret-0123456789abcdefghij',
  WORKER_CONCURRENCY: '2',
};

mkdirSync(resolve(web, 'e2e-results'), { recursive: true });
const log = createWriteStream(resolve(web, 'e2e-results/stack.log'));
const say = (msg: string) => {
  log.write(`[stack] ${msg}\n`);
  process.stdout.write(`[e2e stack] ${msg}\n`);
};

function runOnce(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  log.write(r.stdout);
  log.write(r.stderr);
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed (see e2e-results/stack.log)`);
}

const children: ChildProcess[] = [];
function start(name: string, cmd: string, args: string[], cwd: string, extra = {}): void {
  const child = spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: 'pipe' });
  child.stdout.on('data', (d: Buffer) => log.write(d));
  child.stderr.on('data', (d: Buffer) => log.write(d));
  child.on('exit', (code) => {
    if (!stopping) {
      say(`${name} exited unexpectedly (${String(code)})`);
      stop(1);
    }
  });
  children.push(child);
}

const OIDC_CONTAINER = 'rabit-e2e-oidc';
/**
 * Mock OIDC provider (navikt/mock-oauth2-server): an interactive sign-in page where
 * the test types a subject and optional claims. Every token carries the API
 * audience and a verified email; the web client is the authorized party.
 */
const OIDC_CONFIG = JSON.stringify({
  interactiveLogin: true,
  httpServer: 'NettyWrapper',
  tokenCallbacks: [
    {
      issuerId: 'rabit',
      tokenExpiry: 3600,
      requestMappings: [
        {
          requestParam: 'grant_type',
          match: 'authorization_code',
          claims: {
            aud: ['rabit-api', E2E.oidcClientId],
            azp: E2E.oidcClientId,
            email_verified: true,
          },
        },
      ],
    },
  ],
});

let stopping = false;
function stop(code = 0): void {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  spawnSync('docker', ['rm', '-f', OIDC_CONTAINER]);
  setTimeout(() => process.exit(code), 2_000).unref();
}
process.on('SIGTERM', () => {
  stop();
});
process.on('SIGINT', () => {
  stop();
});

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ok = (url: string) => () => fetch(url).then((r) => r.ok);

/** Fails fast with a clear message instead of a readiness timeout. */
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolveFree, reject) => {
    const probe = createServer();
    probe.once('error', () => {
      reject(
        new Error(
          `port ${String(port)} is already in use; set E2E_API_PORT / E2E_MEDIA_PORT / E2E_WEB_PORT / E2E_METRICS_PORT`,
        ),
      );
    });
    // All interfaces, as the servers bind: a container publishing 0.0.0.0:<port>
    // does not conflict with a probe on 127.0.0.1 alone.
    probe.listen(port, () => {
      probe.close(() => {
        resolveFree();
      });
    });
  });
}

try {
  for (const p of [
    E2E.apiPort,
    E2E.mediaPort,
    E2E.webPort,
    E2E.metricsPort,
    E2E.metricsPort + 1,
    E2E.metricsPort + 2,
    E2E.metricsPort + 3,
    E2E.oidcPort,
    E2E.oidcApiPort,
    E2E.oidcWebPort,
  ])
    await assertPortFree(p);
  say('recreating database rabit_e2e');
  const admin = new pg.Client({ connectionString: E2E.adminDatabaseUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS rabit_e2e WITH (FORCE)');
  await admin.query('CREATE DATABASE rabit_e2e');
  await admin.end();

  runOnce(tsx, ['src/entry/migrate.ts', 'up'], server);
  if (!existsSync(manifest)) runOnce('sh', ['infra/demo/generate-catalog.sh'], root);
  runOnce(tsx, ['src/entry/catalog-ingest.ts', manifest], server);

  start('worker', tsx, ['src/entry/worker.ts'], server);
  start('api', tsx, ['src/entry/api.ts'], server);
  start('media', tsx, ['src/entry/media.ts'], server);

  say('starting the mock OIDC provider');
  spawnSync('docker', ['rm', '-f', OIDC_CONTAINER]);
  runOnce(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      OIDC_CONTAINER,
      '-p',
      `127.0.0.1:${String(E2E.oidcPort)}:8080`,
      '-e',
      `JSON_CONFIG=${OIDC_CONFIG}`,
      'ghcr.io/navikt/mock-oauth2-server:6.0.4',
    ],
    root,
  );
  await waitFor('mock OIDC provider', ok(`${E2E.oidcIssuer}/.well-known/openid-configuration`));
  // A second api that trusts only the mock provider, as production trusts only its own.
  start('api-oidc', tsx, ['src/entry/api.ts'], server, {
    API_PORT: String(E2E.oidcApiPort),
    METRICS_PORT: String(E2E.metricsPort + 3),
    API_PUBLIC_BASE_URL: E2E.oidcApiUrl,
    CORS_ALLOWED_ORIGINS: E2E.oidcWebUrl,
    AUTH_ISSUER: E2E.oidcIssuer,
    AUTH_JWKS_URL: `${E2E.oidcIssuer}/jwks`,
    AUTH_DEV_ISSUER_ENABLED: 'false',
  });

  await waitFor('api', ok(`${E2E.apiUrl}/readyz`));
  await waitFor('api-oidc', ok(`${E2E.oidcApiUrl}/readyz`));
  await waitFor('media', ok(`${E2E.mediaUrl}/healthz`));

  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  await waitFor('catalog processing', async () => {
    const r = await db.query<{ pending: string }>(
      `SELECT count(*) FILTER (WHERE status <> 'ready') AS pending
         FROM audio_source WHERE origin = 'catalog'`,
    );
    return r.rows[0]?.pending === '0';
  });
  // Derived data (search documents, library links) is built by consumers of the
  // ingest events: wait until every event is dispatched and no due job is left.
  await waitFor('event consumers', async () => {
    const r = await db.query<{ busy: string }>(
      `SELECT (SELECT count(*) FROM outbox_event WHERE dispatched_at IS NULL)
            + (SELECT count(*) FROM job WHERE status IN ('queued', 'running')
                                          AND run_after <= now()) AS busy`,
    );
    return r.rows[0]?.busy === '0';
  });
  await db.end();
  say('catalog ready');

  start(
    'web',
    resolve(web, 'node_modules/.bin/vite'),
    ['--port', String(E2E.webPort), '--strictPort'],
    web,
    {
      VITE_API_BASE: E2E.apiUrl,
    },
  );
  start(
    'web-oidc',
    resolve(web, 'node_modules/.bin/vite'),
    ['--port', String(E2E.oidcWebPort), '--strictPort'],
    web,
    {
      VITE_API_BASE: E2E.oidcApiUrl,
      VITE_OIDC_ISSUER: E2E.oidcIssuer,
      VITE_OIDC_CLIENT_ID: E2E.oidcClientId,
    },
  );
  await waitFor('web', ok(E2E.webUrl));
  await waitFor('web-oidc', ok(E2E.oidcWebUrl));
  say(`ready at ${E2E.webUrl}`);
} catch (err) {
  say(`failed: ${(err as Error).message}`);
  stop(1);
}
