// Shared helpers for the local developer scripts (pnpm preflight | bootstrap | dev | status |
// demo:* | db:reset). Plain Node, no dependencies, so they run right after `pnpm install`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = resolve(ROOT, 'apps/server');
export const WEB = resolve(ROOT, 'apps/web');
export const SERVER_ENV = resolve(SERVER, '.env');

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
export const bold = paint('1');
export const dim = paint('2');
export const green = paint('32');
export const yellow = paint('33');
export const red = paint('31');
export const cyan = paint('36');

export const say = (line = '') => process.stdout.write(`${line}\n`);
export const ok = (line) => say(`${green('✓')} ${line}`);
export const warn = (line) => say(`${yellow('!')} ${line}`);
export const fail = (line) => say(`${red('✗')} ${line}`);
export const step = (line) => say(`\n${bold(cyan('▸'))} ${bold(line)}`);

/** Runs a command and returns { status, stdout, stderr } without throwing. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** Runs a command with its output shown; exits the script when it fails. */
export function runOrExit(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(' ')} failed`);
    process.exit(r.status ?? 1);
  }
}

export const has = (cmd) => run('sh', ['-c', `command -v ${cmd}`]).status === 0;

/** KEY=VALUE pairs of a dotenv file (comments and blanks ignored). */
export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Local ports. RABIT_*_PORT override the defaults (e.g. when another project already
 * uses 8080). The worker and media gateway expose metrics on METRICS+1 and METRICS+2.
 */
export function ports() {
  const n = (name, fallback) => Number(process.env[name] ?? fallback);
  const metrics = n('RABIT_METRICS_PORT', 9464);
  return {
    api: n('RABIT_API_PORT', 8080),
    media: n('RABIT_MEDIA_PORT', 8081),
    web: n('RABIT_WEB_PORT', 5173),
    metrics,
    metricsWorker: metrics + 1,
    metricsMedia: metrics + 2,
  };
}

/**
 * Whether a port can be bound on all interfaces, as the servers do. Binding only
 * 127.0.0.1 can succeed on macOS while Docker already publishes the port on 0.0.0.0.
 */
export function portFree(port) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.once('listening', () => srv.close(() => done(true)));
    srv.listen(port);
  });
}

/** Who listens on a port (macOS/Linux with lsof), for a helpful message. */
export function portOwner(port) {
  const r = run('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN']);
  const line = r.stdout.split('\n')[1];
  return line ? line.split(/\s+/).slice(0, 2).join(' ') : 'another process';
}

export async function waitFor(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export const dockerRunning = () => run('docker', ['info']).status === 0;

/** Health of the compose services: { postgres: 'healthy' | 'running' | 'exited' | 'missing', ... }. */
export function infraState() {
  const r = run('docker', [
    'compose',
    'ps',
    '--all',
    '--format',
    '{{.Service}} {{.State}} {{.Health}}',
  ]);
  const state = { postgres: 'missing', s3: 'missing' };
  for (const line of r.stdout.trim().split('\n')) {
    const [service, st, health] = line.split(' ');
    if (service in state) state[service] = health || st;
  }
  return state;
}

/** Runs SQL in the local Postgres container (database `rabit` unless given). */
export function psql(sql, database = 'rabit') {
  return run('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'rabit',
    '-d',
    database,
    '-tAc',
    sql,
  ]);
}

/** True when the dev database already holds the demo catalog (ingest is not idempotent). */
export function demoCatalogPresent() {
  const r = psql("select count(*) from release where title = 'Harbour Lights'");
  return r.status === 0 && Number(r.stdout.trim()) > 0;
}

/** Environment for the server processes, aligned with the chosen ports. */
export function serverEnv(p = ports()) {
  return {
    ...process.env,
    API_PORT: String(p.api),
    MEDIA_PORT: String(p.media),
    METRICS_PORT: String(p.metrics),
    API_PUBLIC_BASE_URL: `http://localhost:${String(p.api)}`,
    MEDIA_PUBLIC_BASE_URL: `http://localhost:${String(p.media)}`,
    AUTH_ISSUER: `http://localhost:${String(p.api)}/dev`,
    CORS_ALLOWED_ORIGINS: `http://localhost:${String(p.web)}`,
  };
}
