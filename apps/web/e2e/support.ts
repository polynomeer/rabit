import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E } from './config.ts';

/** Unique per test so tests never share accounts. */
export const subjectFor = (name: string) =>
  `e2e-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function token(subject: string, operator = false): Promise<string> {
  const r = await fetch(`${E2E.apiUrl}/dev/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, operator }),
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function apiAs(
  subject: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(`${E2E.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token(subject)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: r.status,
    etag: r.headers.get('etag'),
    json: (await r.json().catch(() => null)) as unknown,
  };
}

/**
 * Creates the account and, when asked, makes it a KR subscriber through the
 * operator API — the client never claims territory or subscription itself.
 */
export async function provision(subject: string, opts: { listener?: boolean } = {}) {
  const me = await apiAs(subject, 'GET', '/v1/me');
  expect(me.status).toBe(200);
  const userId = (me.json as { user_id: string }).user_id;
  if (opts.listener) {
    const op = await token(`e2e-operator`, true);
    const ops = (path: string, body: unknown) =>
      fetch(`${E2E.apiUrl}${path}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${op}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => {
        expect(r.status).toBe(200);
      });
    await ops(`/v1/ops/users/${userId}/license-country`, {
      license_country: 'KR',
      reason: 'e2e setup',
    });
    await ops(`/v1/ops/users/${userId}/subscription`, {
      state: 'active',
      paid_through: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      reason: 'e2e setup',
    });
  }
  return userId;
}

/** An operator call (operator role + MFA via the dev issuer), with a reason. */
export async function asOperator(method: string, path: string, body: Record<string, unknown>) {
  const op = await token('e2e-operator', true);
  const r = await fetch(`${E2E.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${op}`,
      'content-type': 'application/json',
      'idempotency-key': `e2e-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as unknown };
}

export async function signIn(page: Page, subject: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('개발용 로그인 ID').fill(subject);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
}

export async function openTab(page: Page, tab: string): Promise<void> {
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('button', { name: tab })
    .click();
}

/** Waits until the player's audio element is actually advancing. */
export async function expectPlaying(page: Page): Promise<number> {
  const audio = page.getByLabel('오디오 컨트롤');
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => (a.paused ? 0 : a.currentTime)), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0.3);
  return audio.evaluate((a: HTMLAudioElement) => a.currentTime);
}

/** A short mono 16-bit PCM WAV (sine tone), generated in memory. */
export function wavTone(seconds = 2, hz = 440, rate = 22_050): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12_000), 44 + i * 2);
  }
  return buf;
}

/** Direct database access, only to seed volume that would be slow through the UI. */
export async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
