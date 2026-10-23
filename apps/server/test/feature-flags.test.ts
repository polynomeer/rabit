import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bucket, clearFlagCache, isEnabled } from '../src/modules/flags/index.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Feature flags (ADR-0028): code defaults, operator overrides, stable rollout buckets. */
let h: Harness;
let u: TestUser;
let op: TestUser;

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  op = await h.user({ operator: true });
});
beforeEach(async () => {
  await h.ctx.db.deleteFrom('feature_flag').execute();
  clearFlagCache();
});
afterAll(async () => {
  await h.ctx.db.deleteFrom('feature_flag').execute();
  await h.close();
});

const features = async (who: TestUser) => {
  const r = await h.api.inject({ url: '/v1/features', headers: who.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ features: Record<string, boolean> }>().features;
};

const set = (key: string, body: Record<string, unknown>, who: TestUser = op) =>
  h.api.inject({
    method: 'PUT',
    url: `/v1/ops/features/${key}`,
    headers: who.headers,
    payload: body,
  });

describe('feature flags', () => {
  it('uses the code default until an operator overrides it', async () => {
    expect((await features(u))['client_diagnostics']).toBe(true);
    const off = await set('client_diagnostics', {
      override: { enabled: false, rollout_percent: 100 },
      reason: 'reports flooding',
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({
      key: 'client_diagnostics',
      default: true,
      override: { enabled: false, rollout_percent: 100, updated_by: op.userId },
    });
    expect((await features(u))['client_diagnostics']).toBe(false);

    // Clearing the override brings the default back.
    await set('client_diagnostics', { override: null, reason: 'fixed' });
    expect((await features(u))['client_diagnostics']).toBe(true);

    const log = await h.ctx.db
      .selectFrom('audit_log')
      .select(['reason', 'actor_id'])
      .where('action', '=', 'feature_flag.changed')
      .where('subject_id', '=', 'client_diagnostics')
      .orderBy('id', 'desc')
      .limit(2)
      .execute();
    expect(log.map((l) => l.reason)).toEqual(['fixed', 'reports flooding']);
  });

  it('rolls out by a stable per-user bucket that only grows', async () => {
    const users = Array.from({ length: 400 }, (_, i) => `usr_rollout_${String(i)}`);
    const share = (pct: number) =>
      users.filter((id) => bucket('client_diagnostics', id) < pct).length / users.length;
    expect(share(0)).toBe(0);
    expect(share(100)).toBe(1);
    expect(share(30)).toBeGreaterThan(0.2);
    expect(share(30)).toBeLessThan(0.4);
    const at30 = users.filter((id) => bucket('client_diagnostics', id) < 30);
    expect(at30.every((id) => bucket('client_diagnostics', id) < 60)).toBe(true);

    await set('client_diagnostics', {
      override: { enabled: true, rollout_percent: 30 },
      reason: 'gradual',
    });
    const inside = at30[0] as string;
    const outside = users.find((id) => bucket('client_diagnostics', id) >= 30) as string;
    expect(await isEnabled(h.ctx.db, 'client_diagnostics', inside)).toBe(true);
    expect(await isEnabled(h.ctx.db, 'client_diagnostics', outside)).toBe(false);
  });

  it('refuses unknown flags, missing reasons and listeners', async () => {
    expect((await set('no_such_flag', { override: null, reason: 'test' })).statusCode).toBe(404);
    expect(
      (
        await set('client_diagnostics', {
          override: { enabled: true, rollout_percent: 100 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await set('client_diagnostics', {
          override: { enabled: true, rollout_percent: 101 },
          reason: 'test',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await set('client_diagnostics', { override: null, reason: 'test' }, u)).statusCode,
    ).toBe(403);
    const list = await h.api.inject({ url: '/v1/ops/features', headers: u.headers });
    expect(list.statusCode).toBe(403);
  });

  it('lists every declared flag for operators', async () => {
    const r = await h.api.inject({ url: '/v1/ops/features', headers: op.headers });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ items: { key: string }[] }>().items.map((i) => i.key)).toContain(
      'client_diagnostics',
    );
  });
});
