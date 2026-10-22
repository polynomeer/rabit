// pnpm worktree <name> [--branch <branch>] [--from <ref>] — a separate checkout under
// .claude/worktrees/<name> for parallel work (one per session or task): fetched from
// origin, dependencies installed, apps/server/.env copied from this checkout.
// Without --branch the checkout is detached at <ref> (default origin/main).
//
// The Postgres/S3 containers are shared by every checkout; `pnpm dev` in a second
// checkout moves to free ports by itself, and `pnpm e2e:local` refuses to run beside
// another e2e run.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { SERVER_ENV, bold, fail, ok, run, runOrExit, say, step } from './lib.mjs';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const name = argv.find(
  (a, i) => !a.startsWith('--') && !['--branch', '--from'].includes(argv[i - 1] ?? ''),
);
const branch = opt('--branch');
const from = opt('--from') ?? 'origin/main';
if (!name || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
  fail('usage: pnpm worktree <name> [--branch <branch>] [--from <ref>]  (name: a-z, 0-9, -)');
  process.exit(1);
}

// The main checkout, also when this command runs inside another worktree.
const common = run('git', [
  'rev-parse',
  '--path-format=absolute',
  '--git-common-dir',
]).stdout.trim();
const repo = dirname(common);
const target = resolve(repo, '.claude/worktrees', name);
if (existsSync(target)) {
  fail(`${target} already exists`);
  process.exit(1);
}

step('Fetching origin');
runOrExit('git', ['fetch', '--quiet', 'origin']);
step(`Creating ${target}`);
runOrExit('git', ['worktree', 'add', ...(branch ? ['-b', branch] : ['--detach']), target, from]);
if (existsSync(SERVER_ENV)) {
  copyFileSync(SERVER_ENV, resolve(target, 'apps/server/.env'));
  ok('copied apps/server/.env');
}
step('Installing dependencies');
runOrExit('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: target });
say(`\n${bold('Ready:')} cd ${target}`);
say(`  then pnpm dev, pnpm verify, …  (remove later with: git worktree remove ${target})`);
