// pnpm preflight — checks everything a local run needs and says how to fix what is missing.
// Exit code 1 when a blocker is found.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ROOT,
  SERVER_ENV,
  bold,
  dim,
  dockerRunning,
  fail,
  has,
  infraState,
  ok,
  portFree,
  portOwner,
  ports,
  run,
  say,
  warn,
} from './lib.mjs';

export async function preflight({ quiet = false } = {}) {
  let blockers = 0;
  const bad = (msg, fix) => {
    blockers++;
    fail(`${msg}${fix ? dim(`  → ${fix}`) : ''}`);
  };
  const note = (msg, fix) => warn(`${msg}${fix ? dim(`  → ${fix}`) : ''}`);
  if (!quiet) say(bold('Rabit — local environment check\n'));

  const [major, minor] = process.versions.node.split('.').map(Number);
  const wanted = readFileSync(resolve(ROOT, '.nvmrc'), 'utf8').trim();
  if (major < 22 || (major === 22 && minor < 12))
    bad(
      `Node ${process.versions.node} is too old (needs >= 22.12)`,
      `install Node ${wanted} (.nvmrc)`,
    );
  else if (String(major) !== wanted) note(`Node ${process.versions.node} (CI uses ${wanted})`);
  else ok(`Node ${process.versions.node}`);

  if (has('pnpm')) ok(`pnpm ${run('pnpm', ['--version']).stdout.trim()}`);
  else bad('pnpm not found', 'corepack enable');

  if (
    existsSync(resolve(ROOT, 'node_modules')) &&
    existsSync(resolve(ROOT, 'apps/server/node_modules'))
  )
    ok('dependencies installed');
  else bad('dependencies not installed', 'pnpm install');

  for (const tool of ['ffmpeg', 'ffprobe'])
    if (has(tool)) ok(tool);
    else
      bad(
        `${tool} not found (audio processing and the demo catalog need it)`,
        'brew install ffmpeg',
      );

  const docker = has('docker') && dockerRunning();
  if (docker) ok('Docker is running');
  else bad('Docker is not running', 'start Docker Desktop');

  if (existsSync(SERVER_ENV)) ok('apps/server/.env');
  else bad('apps/server/.env is missing', 'pnpm bootstrap');

  if (docker) {
    const infra = infraState();
    for (const [svc, st] of Object.entries(infra))
      if (st === 'healthy') ok(`${svc} container healthy`);
      else note(`${svc} container ${st}`, 'pnpm infra:up');
  }

  const p = ports();
  const named = {
    api: p.api,
    media: p.media,
    web: p.web,
    metrics: p.metrics,
    'worker metrics': p.metricsWorker,
    'media metrics': p.metricsMedia,
  };
  const taken = [];
  for (const [name, port] of Object.entries(named))
    if (!(await portFree(port))) taken.push(`${name} ${String(port)} (${portOwner(port)})`);
  if (taken.length === 0) ok(`ports free: ${Object.values(named).join(', ')}`);
  else
    note(
      `ports in use: ${taken.join('; ')}`,
      'pnpm dev moves to the next free set by itself (28080, …); RABIT_*_PORT fixes them',
    );

  say();
  if (blockers === 0) ok(bold('ready'));
  else fail(bold(`${String(blockers)} problem(s) to fix first`));
  return blockers;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = (await preflight()) > 0 ? 1 : 0;
