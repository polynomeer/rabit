// pnpm verify — the CI checks on this machine, before a push, with one summary at the end.
//
//   pnpm verify                 everything CI's check and infra jobs run (needs Docker)
//   pnpm verify -- --quick      lint, type checks and the API types only (about a minute)
//   pnpm verify -- --e2e        also the browser tests (pnpm e2e:local)
//
// Steps whose tool is missing (OpenTofu, shellcheck, swiftc) are skipped, not failed;
// CI still runs them.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  ROOT,
  bold,
  dim,
  dockerRunning,
  green,
  has,
  infraState,
  red,
  say,
  yellow,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const AWS = `${ROOT}/infra/aws`;

/** name, command, cwd, and why it would be skipped (null when it can run). */
const steps = [
  ['lint and format', 'pnpm lint'],
  ['type checks', 'pnpm typecheck'],
  [
    'web API types match the spec',
    'pnpm --filter @rabit/web api:types >/dev/null && git diff --exit-code -- apps/web/src/api-schema.d.ts',
  ],
  ...(quick
    ? []
    : [
        ['OpenAPI lint', 'npx --yes @redocly/cli@1 lint docs/05-api/openapi.yaml'],
        ['build', 'pnpm build'],
        [
          'tests (server, web)',
          'pnpm test',
          ROOT,
          dockerRunning() ? null : 'Docker is not running',
          true,
        ],
        [
          'alert rules',
          'pnpm alerts:check',
          ROOT,
          dockerRunning() ? null : 'Docker is not running',
        ],
        [
          'OpenTofu fmt, validate, tests',
          'tofu fmt -recursive -check && tofu init -backend=false -input=false >/dev/null && tofu validate && tofu test',
          AWS,
          has('tofu') ? null : 'tofu not installed (brew install opentofu)',
        ],
        [
          'shell scripts',
          'shellcheck infra/aws/scripts/*.sh',
          ROOT,
          has('shellcheck') ? null : 'shellcheck not installed (brew install shellcheck)',
        ],
        [
          'iOS shared package',
          'node scripts/ios-check.mjs',
          ROOT,
          process.platform === 'darwin' && has('swiftc') ? null : 'needs macOS with swiftc',
        ],
      ]),
  ...(args.has('--e2e') ? [['browser tests', 'node scripts/e2e-local.mjs']] : []),
];

const results = [];
for (const [name, cmd, cwd = ROOT, skip = null, needsInfra = false] of steps) {
  if (skip) {
    results.push({ name, outcome: 'skipped', note: skip });
    continue;
  }
  if (needsInfra) {
    const s = infraState();
    if (s.postgres !== 'healthy' || s.s3 !== 'healthy') {
      say(dim('\n  starting Postgres and S3 for the tests'));
      spawnSync('pnpm', ['infra:up'], { cwd: ROOT, stdio: 'inherit' });
    }
  }
  say(`\n${bold(`▸ ${name}`)} ${dim(cmd)}`);
  const started = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd, stdio: 'inherit' });
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({
    name,
    outcome: r.status === 0 ? 'passed' : 'failed',
    note: `${String(seconds)} s`,
  });
}

say(`\n${bold('Summary')}`);
for (const r of results) {
  const mark =
    r.outcome === 'passed' ? green('✓') : r.outcome === 'failed' ? red('✗') : yellow('–');
  say(`  ${mark} ${r.name.padEnd(32)} ${dim(r.note)}`);
}
const failed = results.filter((r) => r.outcome === 'failed').length;
say(failed === 0 ? green('\nAll checks passed.') : red(`\n${String(failed)} check(s) failed.`));
process.exit(failed === 0 ? 0 : 1);
