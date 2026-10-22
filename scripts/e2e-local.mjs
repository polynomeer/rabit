// pnpm e2e:local [-- <playwright args>] — the browser tests on this machine, on free
// ports: each E2E_* port that another program holds is moved to a free one, so a busy
// 18080 (or any other) does not stop the run. Refuses while another e2e run is going
// (they share the rabit_e2e database); --force runs anyway.
//
//   pnpm e2e:local                      every spec
//   pnpm e2e:local -- next-track        specs whose file name matches
//   pnpm e2e:local -- --headed          any Playwright flag
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  WEB,
  dim,
  fail,
  freePortFrom,
  infraState,
  ok,
  portFree,
  run,
  say,
  step,
  yellow,
} from './lib.mjs';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const force = argv.includes('--force');
const pass = argv.filter((a) => a !== '--force');

const others = run('pgrep', ['-f', 'playwright test']).stdout.trim().split('\n').filter(Boolean);
if (others.length > 0 && !force) {
  fail(
    `another e2e run is going (pid ${others.join(', ')}); they share rabit_e2e — wait, or --force`,
  );
  process.exit(1);
}

step('Ports');
const single = {
  E2E_API_PORT: 18080,
  E2E_MEDIA_PORT: 18081,
  E2E_WEB_PORT: 15173,
  E2E_OIDC_PORT: 18090,
  E2E_OIDC_API_PORT: 18082,
  E2E_OIDC_WEB_PORT: 15174,
  E2E_CSP_WEB_PORT: 15175,
};
const env = { ...process.env };
const chosen = new Set();
for (const [name, fallback] of Object.entries(single)) {
  const want = Number(process.env[name] ?? fallback);
  const port =
    (await portFree(want)) && !chosen.has(want) ? want : await freePortFrom(38_000, chosen);
  if (port !== want) say(yellow(`  ${name} ${String(want)} is taken → ${String(port)}`));
  env[name] = String(port);
  chosen.add(port);
}
// The metrics ports are four in a row (api, worker, media, oidc api).
let metrics = Number(process.env.E2E_METRICS_PORT ?? 19464);
const block = async (base) =>
  (await Promise.all([0, 1, 2, 3].map((i) => portFree(base + i)))).every(Boolean) &&
  ![0, 1, 2, 3].some((i) => chosen.has(base + i));
if (!(await block(metrics))) {
  const from = metrics;
  metrics = 39_000;
  while (!(await block(metrics))) metrics += 4;
  say(yellow(`  E2E_METRICS_PORT ${String(from)} is taken → ${String(metrics)}`));
}
env.E2E_METRICS_PORT = String(metrics);
ok(`api ${env.E2E_API_PORT}, web ${env.E2E_WEB_PORT}, metrics ${env.E2E_METRICS_PORT}+`);

const s = infraState();
if (s.postgres !== 'healthy' || s.s3 !== 'healthy') {
  step('Starting Postgres and S3');
  spawnSync('pnpm', ['infra:up'], { stdio: 'inherit' });
}

step(`playwright test ${pass.join(' ')}`);
say(dim('  The stack (api, worker, media, web, OIDC mock) starts inside the run.'));
const r = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', ...pass],
  {
    cwd: WEB,
    env,
    stdio: 'inherit',
  },
);
process.exit(r.status ?? 1);
