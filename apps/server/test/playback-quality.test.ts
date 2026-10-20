import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../src/platform/metrics.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Client playback quality reports (QoE, slo.md): once per session, metrics only. */
let h: Harness;
let cat: Awaited<ReturnType<typeof seedCatalog>>;
let ops: Awaited<ReturnType<typeof asOperator>>;

beforeAll(async () => {
  h = await createHarness();
  ops = await asOperator(h);
  cat = await seedCatalog(h);
});
afterAll(() => h.close());

async function session(u: TestUser) {
  const r = await h.api.inject({
    method: 'POST',
    url: '/v1/playback-sessions',
    headers: u.headers,
    payload: { recording_id: cat.ids['r1'], device_id: 'device-qoe-1' },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ session_id: string }>().session_id;
}

const report = (u: TestUser, id: string, body: Record<string, unknown>) =>
  h.api.inject({
    method: 'POST',
    url: `/v1/playback-sessions/${id}/quality`,
    headers: u.headers,
    payload: {
      platform: 'web',
      startup_ms: 800,
      played_ms: 0,
      stall_count: 0,
      stall_ms: 0,
      error: null,
      ...body,
    },
  });

async function value(name: string, labels: Record<string, string>) {
  const m = (await registry.getSingleMetric(name)?.get()) as
    | { values: { labels: Record<string, string>; value: number; metricName?: string }[] }
    | undefined;
  return (m?.values ?? [])
    .filter((v) => !v.metricName || v.metricName === `${name}_count` || v.metricName === name)
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((n, v) => n + v.value, 0);
}

describe('playback quality reports', () => {
  it('turns one report per session into platform metrics', async () => {
    const u = await h.user();
    await ops.setCountry(u, 'KR');
    await ops.subscribe(u);
    const id = await session(u);
    const before = {
      reports: await value('rabit_playback_quality_reports_total', {
        platform: 'ios',
        outcome: 'accepted',
      }),
      stalls: await value('rabit_playback_stalls_total', { platform: 'ios' }),
      errors: await value('rabit_playback_client_errors_total', {
        platform: 'ios',
        code: 'network',
      }),
      startups: await value('rabit_playback_startup_seconds', { platform: 'ios' }),
    };
    const r = await report(u, id, {
      platform: 'ios',
      startup_ms: 1200,
      played_ms: 1000,
      stall_count: 2,
      stall_ms: 300,
      error: 'network',
    });
    expect(r.statusCode, r.body).toBe(204);
    expect(
      await value('rabit_playback_quality_reports_total', { platform: 'ios', outcome: 'accepted' }),
    ).toBe(before.reports + 1);
    expect(await value('rabit_playback_stalls_total', { platform: 'ios' })).toBe(before.stalls + 2);
    expect(
      await value('rabit_playback_client_errors_total', { platform: 'ios', code: 'network' }),
    ).toBe(before.errors + 1);
    expect(await value('rabit_playback_startup_seconds', { platform: 'ios' })).toBe(
      before.startups + 1,
    );

    // A repeated report changes nothing.
    const dup = await report(u, id, { platform: 'ios', stall_count: 50 });
    expect(dup.statusCode).toBe(204);
    expect(await value('rabit_playback_stalls_total', { platform: 'ios' })).toBe(before.stalls + 2);
    expect(
      await value('rabit_playback_quality_reports_total', {
        platform: 'ios',
        outcome: 'duplicate',
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("refuses other users' sessions, bad input and time the session cannot have had", async () => {
    const [u, other] = [await h.user(), await h.user()];
    for (const x of [u, other]) {
      await ops.setCountry(x, 'KR');
      await ops.subscribe(x);
    }
    const id = await session(u);
    expect((await report(other, id, {})).statusCode).toBe(404);
    expect((await report(u, id, { platform: 'android' })).statusCode).toBe(400);
    expect((await report(u, id, { stall_ms: -1 })).statusCode).toBe(400);
    const before = await value('rabit_playback_played_seconds_total', { platform: 'web' });
    expect((await report(u, id, { played_ms: 3_600_000 })).statusCode).toBe(204);
    expect(await value('rabit_playback_played_seconds_total', { platform: 'web' })).toBe(before);
    expect(
      await value('rabit_playback_quality_reports_total', {
        platform: 'web',
        outcome: 'implausible',
      }),
    ).toBeGreaterThanOrEqual(1);
  });
});
