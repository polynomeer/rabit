// pnpm bootstrap — one-time local setup from a clean clone:
//   apps/server/.env (fresh secrets) → Postgres + S3 → migrations → demo catalog.
// Safe to re-run: an existing .env and an ingested catalog are left as they are.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { seedDemo } from './demo.mjs';
import { preflight } from './preflight.mjs';
import { ROOT, SERVER_ENV, bold, ok, runOrExit, say, step } from './lib.mjs';

step('Environment file');
if (existsSync(SERVER_ENV)) ok('apps/server/.env exists (kept as is)');
else {
  // The example's secrets are placeholders; a local file gets its own random ones.
  const secret = () => randomBytes(36).toString('base64url');
  const env = readFileSync(resolve(ROOT, '.env.example'), 'utf8')
    .replace(/^MEDIA_TOKEN_SECRET=.*$/m, `MEDIA_TOKEN_SECRET=${secret()}`)
    .replace(/^CURSOR_SECRET=.*$/m, `CURSOR_SECRET=${secret()}`)
    .replace(/^PAYMENTS_MOCK_WEBHOOK_SECRET=.*$/m, `PAYMENTS_MOCK_WEBHOOK_SECRET=${secret()}`);
  writeFileSync(SERVER_ENV, env, { mode: 0o600 });
  ok('created apps/server/.env from .env.example with new local secrets');
}

step('Checking prerequisites');
if ((await preflight({ quiet: true })) > 0) {
  say('\nFix the problems above, then run pnpm bootstrap again.');
  process.exit(1);
}

step('Postgres and S3 (Docker)');
runOrExit('pnpm', ['infra:up']);

step('Database migrations');
runOrExit('pnpm', ['db:migrate']);

step('Demo catalog');
seedDemo();

say(`\n${bold('Set up.')} Next: ${bold('pnpm dev')} — then sign in with any ID and run`);
say(`  pnpm demo:user <that ID>   to give it region KR and a Listen subscription.`);
