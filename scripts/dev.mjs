// pnpm dev — the whole local stack in one terminal: api, worker, media gateway and the
// web client, with prefixed logs. On a fresh clone it runs `pnpm bootstrap` first; it
// brings Postgres/S3 up, applies migrations and ingests the demo catalog when needed.
// Ctrl-C (or `pnpm stop` from another terminal) stops everything.
//
//   pnpm dev                    defaults: api 8080, media 8081, web 5173, metrics 9464-9466;
//                               when one is taken, the next free set (28080, 28081, 25173, …)
//   RABIT_API_PORT=… pnpm dev   fixed ports (no automatic move)
//   pnpm dev -- --no-web        servers only
//   pnpm dev -- --no-seed       skip the demo catalog
//
// The chosen ports go to .tmp/dev.json, so pnpm status, demo:user and stop find them.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { seedDemo, seedOffers } from './demo.mjs';
import {
  SERVER_ENV,
  WEB,
  clearRunState,
  freePorts,
  portsFromEnv,
  runState,
  writeRunState,
  bold,
  cyan,
  dim,
  dockerRunning,
  fail,
  green,
  infraState,
  ok,
  portFree,
  portOwner,
  ports,
  red,
  runOrExit,
  say,
  serverEnv,
  step,
  waitFor,
  yellow,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const withWeb = !args.has('--no-web');

const already = runState();
if (already) {
  fail(
    `pnpm dev is already running here (pid ${String(already.pid)}, web http://localhost:${String(already.ports.web)}) — pnpm stop`,
  );
  process.exit(1);
}
let p = ports();

if (!existsSync(SERVER_ENV)) {
  step('First run: pnpm bootstrap');
  runOrExit('pnpm', ['bootstrap']);
}
if (!dockerRunning()) {
  fail('Docker is not running — start Docker Desktop');
  process.exit(1);
}

step('Checking ports');
const needed = {
  api: p.api,
  media: p.media,
  metrics: p.metrics,
  'worker metrics': p.metricsWorker,
  'media metrics': p.metricsMedia,
  ...(withWeb ? { web: p.web } : {}),
};
let taken = [];
for (const [name, port] of Object.entries(needed))
  if (!(await portFree(port))) taken.push(`${name} ${String(port)} is used by ${portOwner(port)}`);
if (taken.length > 0 && !portsFromEnv()) {
  const moved = await freePorts(p, [
    'api',
    'media',
    'metrics',
    'metricsWorker',
    'metricsMedia',
    ...(withWeb ? ['web'] : []),
  ]);
  if (moved) {
    for (const t of taken) say(dim(`  ${t}`));
    say(yellow(`  → using the next free set: api ${String(moved.api)}, web ${String(moved.web)}`));
    p = moved;
    needed.api = p.api;
    needed.media = p.media;
    needed.metrics = p.metrics;
    needed['worker metrics'] = p.metricsWorker;
    needed['media metrics'] = p.metricsMedia;
    if (withWeb) needed.web = p.web;
    taken = [];
  }
}
if (taken.length > 0) {
  for (const t of taken) fail(t);
  say(
    dim(
      '  Stop it, or choose other ports, e.g. RABIT_API_PORT=28080 RABIT_MEDIA_PORT=28081 RABIT_METRICS_PORT=29464 pnpm dev',
    ),
  );
  process.exit(1);
}
ok(
  Object.entries(needed)
    .map(([n, v]) => `${n} ${String(v)}`)
    .join(', '),
);

const infra = infraState();
if (infra.postgres !== 'healthy' || infra.s3 !== 'healthy') {
  step('Starting Postgres and S3');
  runOrExit('pnpm', ['infra:up']);
}
step('Migrations');
runOrExit('pnpm', ['db:migrate'], { env: serverEnv(p) });
if (!args.has('--no-seed')) {
  step('Demo catalog');
  seedDemo();
}

step('Starting services');
const colours = { api: cyan, worker: yellow, media: green, web: bold };
const children = [];
let stopping = false;
function start(name, cmdArgs, env, cwd) {
  const child = spawn('pnpm', cmdArgs, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = colours[name](name.padEnd(6));
  const pipe = (stream) => {
    let rest = '';
    stream.on('data', (d) => {
      const lines = (rest + d.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${tag} ${line}\n`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      fail(`${name} exited (${String(code)}) — stopping the rest`);
      stop(1);
    }
  });
  children.push(child);
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearRunState();
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3_000).unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

writeRunState({
  pid: process.pid,
  ports: { api: p.api, media: p.media, web: p.web, metrics: p.metrics },
  web: withWeb,
  startedAt: new Date().toISOString(),
});
process.on('exit', () => {
  if (runState()?.pid === process.pid) clearRunState();
});

const env = serverEnv(p);
start('api', ['--filter', '@rabit/server', 'dev:api'], env);
start('worker', ['--filter', '@rabit/server', 'dev:worker'], env);
start('media', ['--filter', '@rabit/server', 'dev:media'], env);
if (withWeb)
  start(
    'web',
    ['exec', 'vite', '--port', String(p.web), '--strictPort'],
    { ...process.env, VITE_API_BASE: `http://localhost:${String(p.api)}` },
    WEB,
  );

const ready = await Promise.all([
  waitFor(`http://localhost:${String(p.api)}/readyz`, 90_000),
  waitFor(`http://localhost:${String(p.media)}/healthz`, 90_000),
  ...(withWeb ? [waitFor(`http://localhost:${String(p.web)}/`, 90_000)] : []),
]);
if (ready.every(Boolean)) {
  if (!args.has('--no-seed'))
    await seedOffers({ quiet: true }).catch((e) => {
      say(yellow(`  demo offers not added: ${e.message}`));
    });
  say(`\n${bold(green('Rabit is running'))}`);
  if (withWeb)
    say(`  web     ${bold(`http://localhost:${String(p.web)}`)}   (sign in with any ID)`);
  say(`  api     http://localhost:${String(p.api)}`);
  say(`  media   http://localhost:${String(p.media)}`);
  say(dim(`  In another terminal: pnpm demo:user <ID> — region KR + subscription so tracks play.`));
  say(dim('  Ctrl-C here, or pnpm stop in another terminal, stops everything.\n'));
} else if (!stopping) {
  say(red('\nSome services did not become ready in 90 s; see the logs above.'));
}
