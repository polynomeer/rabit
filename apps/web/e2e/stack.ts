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

let stopping = false;
function stop(code = 0): void {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
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

try {
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
  await waitFor('api', ok(`${E2E.apiUrl}/readyz`));
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
  await waitFor('web', ok(E2E.webUrl));
  say(`ready at ${E2E.webUrl}`);
} catch (err) {
  say(`failed: ${(err as Error).message}`);
  stop(1);
}
