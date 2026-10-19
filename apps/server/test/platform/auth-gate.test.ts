import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';

/**
 * The authentication and rate-limit gate follows the route Fastify matched, not
 * the raw URL (architecture review 2026-10-19): a percent-encoded `/v1` path
 * reaches the same handler and must pass the same gate.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('API gate', () => {
  it('authenticates a percent-encoded API path like the plain one', async () => {
    const u = await h.user();
    for (const url of ['/v1/me', '/%761/me', '/v%31/me']) {
      const ok = await h.api.inject({ url, headers: u.headers });
      expect(ok.statusCode, `${url}: ${ok.body}`).toBe(200);
      const anonymous = await h.api.inject({ url });
      expect(anonymous.statusCode, url).toBe(401);
    }
  });

  it('keeps an account being deleted out of encoded paths too', async () => {
    const u = await h.user();
    const del = await h.api.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { ...u.headers, 'idempotency-key': `gate-del-${u.userId}` },
    });
    expect(del.statusCode).toBe(202);
    const r = await h.api.inject({ url: '/%761/library', headers: u.headers });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('ACCOUNT_DELETION_PENDING');
  });
});
