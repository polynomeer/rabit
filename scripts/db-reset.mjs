// pnpm db:reset -- --test — empties the server tests' database (rabit_test) instead.
// pnpm db:reset [--yes] [--no-seed] — drops and recreates the LOCAL development database
// `rabit` (in the Docker Postgres), re-applies migrations and re-ingests the demo catalog.
// Refuses unless DATABASE_URL in apps/server/.env points at localhost. Objects already in
// the local S3 are not removed (they become unreferenced); `pnpm infra:down -v` clears both.
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { seedDemo } from './demo.mjs';
import {
  SERVER_ENV,
  bold,
  fail,
  infraState,
  ok,
  psql,
  readEnvFile,
  red,
  runOrExit,
  say,
  step,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));

// --test: the server tests' database. Branches with different migrations share it, and
// a migration missing on the current branch stops the test setup ("corrupted
// migrations"); an empty schema lets the next test run migrate from scratch.
if (args.has('--test')) {
  if (infraState().postgres !== 'healthy') {
    fail('local Postgres is not running — pnpm infra:up');
    process.exit(1);
  }
  step('Emptying the test database rabit_test');
  const exists = psql("select 1 from pg_database where datname = 'rabit_test'", 'postgres');
  const sqls =
    exists.stdout.trim() === '1'
      ? [['drop schema if exists public cascade; create schema public;', 'rabit_test']]
      : [['create database rabit_test owner rabit', 'postgres']];
  for (const [sql, db] of sqls) {
    const r = psql(sql, db);
    if (r.status !== 0) {
      fail(r.stderr.trim() || sql);
      process.exit(1);
    }
  }
  ok('rabit_test is empty; the next pnpm test migrates it');
  process.exit(0);
}

const url = readEnvFile(SERVER_ENV).DATABASE_URL ?? '';
let host = '';
try {
  host = new URL(url).hostname;
} catch {
  // handled below
}
if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !url.endsWith('/rabit')) {
  fail(`refusing: DATABASE_URL is not the local dev database (${url || 'unset'})`);
  process.exit(1);
}
if (infraState().postgres !== 'healthy') {
  fail('local Postgres is not running — pnpm infra:up');
  process.exit(1);
}

if (!args.has('--yes')) {
  if (!process.stdin.isTTY) {
    fail('pass --yes to reset without a prompt');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `${red(bold('This deletes every local account, upload and playlist'))} in database "rabit". Type "reset" to continue: `,
  );
  rl.close();
  if (answer.trim() !== 'reset') {
    say('cancelled');
    process.exit(1);
  }
}

step('Recreating database rabit');
for (const sql of [
  "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'rabit' and pid <> pg_backend_pid()",
  'drop database if exists rabit',
  'create database rabit owner rabit',
]) {
  const r = psql(sql, 'postgres');
  if (r.status !== 0) {
    fail(r.stderr.trim() || sql);
    process.exit(1);
  }
}
ok('database rabit is empty');

step('Migrations');
runOrExit('pnpm', ['db:migrate']);
if (!args.has('--no-seed')) {
  step('Demo catalog');
  seedDemo();
}
say(`\n${bold('Reset done.')} Restart pnpm dev if it was running.`);
