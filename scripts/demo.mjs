// pnpm demo:seed            — generate (ffmpeg) and ingest the fictional demo catalog once.
// pnpm demo:user <ID> [--operator]
//                           — give a local account region KR and an active Listen
//                             subscription (through the operator API, as the e2e tests do),
//                             so catalog tracks play. Needs `pnpm dev` (the api) running.
// Local development only: it uses the built-in dev token issuer.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { ROOT, bold, demoCatalogPresent, fail, ok, ports, runOrExit, say } from './lib.mjs';

const MANIFEST = resolve(ROOT, 'infra/demo/out/manifest.json');

export function seedDemo({ force = false } = {}) {
  if (!force && demoCatalogPresent()) {
    ok(
      'demo catalog already ingested (catalog ingest is not idempotent; use --force to add it again)',
    );
    return;
  }
  if (!existsSync(MANIFEST)) runOrExit('sh', ['infra/demo/generate-catalog.sh']);
  runOrExit('pnpm', ['--filter', '@rabit/server', 'catalog:ingest', MANIFEST], { cwd: ROOT });
  ok('demo catalog ingested; the worker processes the audio once pnpm dev runs');
}

async function demoUser(subject, operator) {
  const api = `http://localhost:${String(ports().api)}`;
  const token = async (sub, op) => {
    const res = await fetch(`${api}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: sub, operator: op }),
    });
    if (!res.ok) throw new Error(`dev token ${String(res.status)}: is pnpm dev running?`);
    return (await res.json()).access_token;
  };
  const user = await token(subject, operator);
  const me = await (
    await fetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${user}` } })
  ).json();
  const op = await token('local-operator', true);
  const put = async (path, body) => {
    const res = await fetch(`${api}${path}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${op}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, reason: 'local development (pnpm demo:user)' }),
    });
    if (!res.ok) throw new Error(`${path} → ${String(res.status)} ${await res.text()}`);
  };
  await put(`/v1/ops/users/${me.user_id}/license-country`, { license_country: 'KR' });
  await put(`/v1/ops/users/${me.user_id}/subscription`, {
    state: 'active',
    paid_through: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  ok(`${bold(subject)}: region KR, Listen subscription for 30 days${operator ? ', operator' : ''}`);
  say(
    `  Sign in at http://localhost:${String(ports().web)} with the ID ${bold(subject)}${operator ? ' (tick 운영자)' : ''}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'seed') seedDemo({ force: rest.includes('--force') });
  else if (cmd === 'user' && rest[0] && !rest[0].startsWith('-'))
    await demoUser(rest[0], rest.includes('--operator')).catch((e) => {
      fail(e.message);
      process.exitCode = 1;
    });
  else {
    say('usage: pnpm demo:seed [--force] | pnpm demo:user <ID> [--operator]');
    process.exitCode = 2;
  }
}
