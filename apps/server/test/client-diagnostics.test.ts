import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint, MAX_GROUPS, scrub } from '../src/modules/diagnostics/index.js';
import { registry } from '../src/platform/metrics.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Client diagnostics (ADR-0027): grouped errors without user data, metrics. */
let h: Harness;
let u: TestUser;
let op: TestUser;

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  op = await h.user({ operator: true });
});
beforeEach(async () => {
  await h.ctx.db.deleteFrom('client_error_group').execute();
});
afterAll(() => h.close());

const send = (body: Record<string, unknown>, who: TestUser = u) =>
  h.api.inject({
    method: 'POST',
    url: '/v1/client-diagnostics',
    headers: who.headers,
    payload: { platform: 'web', app_version: '1.4.0', ...body },
  });

const groups = async (query = '') => {
  const r = await h.api.inject({ url: `/v1/ops/client-errors${query}`, headers: op.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ items: Record<string, unknown>[] }>().items;
};

async function value(name: string, labels: Record<string, string>) {
  const m = (await registry.getSingleMetric(name)?.get()) as
    | { values: { labels: Record<string, string>; value: number; metricName?: string }[] }
    | undefined;
  return (m?.values ?? [])
    .filter((v) => !v.metricName || v.metricName === `${name}_count` || v.metricName === name)
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((n, v) => n + v.value, 0);
}

const typeError = {
  kind: 'unhandled',
  name: 'TypeError',
  message: "Cannot read properties of undefined (reading 'title')",
  frames: [
    'at renderRow (https://app.rabit.test/assets/index-a1b2.js:12:3456)',
    'at Queue (https://app.rabit.test/assets/index-a1b2.js:40:99)',
  ],
};

describe('client diagnostics', () => {
  it('groups the same error across builds and counts launches and kinds', async () => {
    const launches = await value('rabit_client_launches_total', { platform: 'web' });
    const unhandled = await value('rabit_client_errors_reported_total', {
      platform: 'web',
      kind: 'unhandled',
    });
    expect((await send({ launches: 3, errors: [typeError] })).statusCode).toBe(204);
    // The next build moved the code: other line numbers, same error.
    const moved = {
      ...typeError,
      count: 4,
      frames: typeError.frames.map((f) => f.replace(/:\d+:\d+\)$/, ':77:1)')),
    };
    expect((await send({ app_version: '1.4.1', errors: [moved] })).statusCode).toBe(204);

    const [g, ...rest] = await groups('?platform=web');
    expect(rest).toEqual([]);
    expect(g).toMatchObject({
      platform: 'web',
      kind: 'unhandled',
      name: 'TypeError',
      count: 5,
      first_app_version: '1.4.0',
      last_app_version: '1.4.1',
    });
    expect(await value('rabit_client_launches_total', { platform: 'web' })).toBe(launches + 3);
    expect(
      await value('rabit_client_errors_reported_total', { platform: 'web', kind: 'unhandled' }),
    ).toBe(unhandled + 5);
  });

  it('keeps people and resources out of what it stores, and stores no user', async () => {
    const r = await send({
      errors: [
        {
          kind: 'error',
          name: 'ApiError',
          message:
            'GET https://api.rabit.test/v1/playlists/pl_01HZZZZZZZZZZZZZZZZZZZZZZZ?token=secret failed for jane@example.com, card 4111111111111111',
          frames: ['at load (https://app.rabit.test/assets/a.js?v=secret#x:1:2)'],
        },
      ],
    });
    expect(r.statusCode).toBe(204);
    const [g] = await groups();
    expect(g?.['message']).toBe(
      'GET https://api.rabit.test/v1/playlists/<id> failed for <email>, card <n>',
    );
    expect(g?.['frames']).toEqual(['at load (https://app.rabit.test/assets/a.js)']);
    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'client_error_group'`.execute(
      h.ctx.db,
    );
    const names = columns.rows.map((c) => c.column_name);
    expect(names.some((c) => /user|ip|device|subject/.test(c))).toBe(false);
  });

  it('keeps iOS binary offsets, which only mean something per build', () => {
    const a = ['Rabit 0x0000000100a3c4d8', 'SwiftUI 0x00000001a2b3c4d5'];
    const b = ['Rabit 0x0000000100a3c4e0', 'SwiftUI 0x00000001a2b3c4d5'];
    expect(scrub(a[0] as string, 300, { numbers: false })).toBe(a[0]);
    expect(fingerprint('ios', 'crash', 'EXC_BAD_ACCESS', a)).not.toBe(
      fingerprint('ios', 'crash', 'EXC_BAD_ACCESS', b),
    );
    // The client cannot pick the group: it is the server's hash.
    expect(fingerprint('web', 'error', 'E', ['x'])).not.toBe(
      fingerprint('ios', 'error', 'E', ['x']),
    );
  });

  it('stops creating groups at the cap but still counts existing ones', async () => {
    await send({ errors: [typeError] });
    await sql`
      INSERT INTO client_error_group
        (fingerprint, platform, kind, name, message, frames, count, first_app_version, last_app_version)
      SELECT 'fill-' || g, 'web', 'error', 'Fill', '', '[]'::jsonb, 1, '1', '1'
      FROM generate_series(1, ${MAX_GROUPS - 1}) g`.execute(h.ctx.db);
    const dropped = await value('rabit_client_error_groups_dropped_total', { platform: 'web' });
    await send({ errors: [{ ...typeError, name: 'RangeError' }, typeError] });
    const all = await h.ctx.db
      .selectFrom('client_error_group')
      .select(['name', 'count'])
      .where('name', 'in', ['RangeError', 'TypeError'])
      .execute();
    expect(all).toEqual([{ name: 'TypeError', count: 2 }]);
    expect(await value('rabit_client_error_groups_dropped_total', { platform: 'web' })).toBe(
      dropped + 1,
    );
  });

  it('records web vitals', async () => {
    const before = await value('rabit_web_vitals_lcp_seconds', {});
    expect((await send({ vitals: { lcp_ms: 1800, inp_ms: 120, cls: 0.02 } })).statusCode).toBe(204);
    expect(await value('rabit_web_vitals_lcp_seconds', {})).toBe(before + 1);
  });

  it('refuses malformed batches, anonymous callers and listeners on the operator view', async () => {
    expect((await send({ app_version: '1.0 <script>' })).statusCode).toBe(400);
    expect((await send({ errors: [{ ...typeError, kind: 'oops' }] })).statusCode).toBe(400);
    expect((await send({ user_id: 'usr_x' })).statusCode).toBe(400);
    const anon = await h.api.inject({
      method: 'POST',
      url: '/v1/client-diagnostics',
      payload: { platform: 'web', app_version: '1' },
    });
    expect(anon.statusCode).toBe(401);
    const listener = await h.api.inject({ url: '/v1/ops/client-errors', headers: u.headers });
    expect(listener.statusCode).toBe(403);
  });

  it('purges groups unseen for 30 days', async () => {
    await send({ errors: [typeError] });
    await h.ctx.db
      .updateTable('client_error_group')
      .set({ last_seen_at: new Date(Date.now() - 31 * 86_400_000) })
      .execute();
    await send({ errors: [{ ...typeError, name: 'Fresh' }] });
    const { purgeErrorGroups } = await import('../src/modules/diagnostics/diagnostics.js');
    expect(await purgeErrorGroups(h.ctx.db)).toBe(1);
    expect((await groups()).map((g) => g['name'])).toEqual(['Fresh']);
  });
});
