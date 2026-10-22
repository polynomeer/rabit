// pnpm demo:seed            — generate (ffmpeg) and ingest the fictional demo catalog once:
//                             infra/demo/catalog/core.json (what the e2e tests use) and
//                             expansion.json (25 releases, 1976–2026). Album offers are
//                             added by `pnpm dev` once the api answers (pnpm demo:offers).
// pnpm demo:user <ID> [--operator]
//                           — give a local account region KR and an active Listen
//                             subscription (through the operator API, as the e2e tests do),
//                             so catalog tracks play. Needs `pnpm dev` (the api) running.
// pnpm demo:offers          — put the expansion's albums on sale (operator API; needs the api).
// Local development only: it uses the built-in dev token issuer.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { ROOT, bold, fail, ok, ports, psql, runOrExit, say } from './lib.mjs';

/** The demo catalog sets, ingested in this order (infra/demo/catalog/<set>.json). */
export const DEMO_SETS = ['core', 'expansion'];
const out = (set, file) => resolve(ROOT, 'infra/demo/out', set, file);
const sql = (s) => `'${s.replace(/'/g, "''")}'`;

/** A set counts as ingested when its first release exists (catalog ingest is not idempotent). */
function setPresent(set) {
  const source = JSON.parse(readFileSync(resolve(ROOT, `infra/demo/catalog/${set}.json`), 'utf8'));
  const first = source.releases[0];
  const r = psql(
    `select count(*) from release where title = ${sql(first.title)} and release_date = ${sql(first.date)}`,
  );
  return r.status === 0 && Number(r.stdout.trim()) > 0;
}

export function seedDemo() {
  for (const set of DEMO_SETS) {
    if (setPresent(set)) {
      ok(`demo catalog "${set}" already ingested`);
      continue;
    }
    if (!existsSync(out(set, 'manifest.json')))
      runOrExit('node', ['infra/demo/generate.mjs', set], { cwd: ROOT });
    runOrExit('pnpm', ['--filter', '@rabit/server', 'catalog:ingest', out(set, 'manifest.json')], {
      cwd: ROOT,
    });
    ok(`demo catalog "${set}" ingested; the worker processes its audio once pnpm dev runs`);
  }
}

async function devToken(api, subject, operator) {
  const res = await fetch(`${api}/dev/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, operator }),
  });
  if (!res.ok) throw new Error(`dev token ${String(res.status)}: is pnpm dev running?`);
  return (await res.json()).access_token;
}

/**
 * Puts the demo albums with a price on sale in KR, through the operator API (so the
 * offer is audited like a real one). Albums that already have an offer are skipped.
 */
export async function seedOffers({ quiet = false } = {}) {
  const api = `http://localhost:${String(ports().api)}`;
  let op = null;
  let added = 0;
  for (const set of DEMO_SETS) {
    if (!existsSync(out(set, 'offers.json'))) continue;
    for (const o of JSON.parse(readFileSync(out(set, 'offers.json'), 'utf8'))) {
      const found = psql(
        `select r.id, (select count(*) from offer f where f.release_id = r.id) from release r where r.title = ${sql(o.title)} and r.release_date = ${sql(o.date)} limit 1`,
      ).stdout.trim();
      const [releaseId, offers] = found.split('|');
      if (!releaseId || Number(offers) > 0) continue;
      op ??= await devToken(api, 'local-operator', true);
      const res = await fetch(`${api}/v1/ops/offers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${op}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          release_id: releaseId,
          territories: ['KR'],
          price_minor: o.price_minor,
          reason: 'demo catalog (pnpm demo:offers)',
        }),
      });
      if (!res.ok)
        throw new Error(`offer for ${o.title} → ${String(res.status)} ${await res.text()}`);
      added++;
    }
  }
  if (added > 0) ok(`${String(added)} demo album(s) on sale`);
  else if (!quiet) ok('demo albums already on sale');
}

async function demoUser(subject, operator) {
  const api = `http://localhost:${String(ports().api)}`;
  const user = await devToken(api, subject, operator);
  const me = await (
    await fetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${user}` } })
  ).json();
  const op = await devToken(api, 'local-operator', true);
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
  if (cmd === 'seed') seedDemo();
  else if (cmd === 'offers')
    await seedOffers().catch((e) => {
      fail(e.message);
      process.exitCode = 1;
    });
  else if (cmd === 'user' && rest[0] && !rest[0].startsWith('-'))
    await demoUser(rest[0], rest.includes('--operator')).catch((e) => {
      fail(e.message);
      process.exitCode = 1;
    });
  else {
    say('usage: pnpm demo:seed | pnpm demo:offers | pnpm demo:user <ID> [--operator]');
    process.exitCode = 2;
  }
}
