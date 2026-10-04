import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../src/platform/db/db.js';
import { ulid } from '../../src/platform/ids.js';
import { installRateLimit, routeLimit } from '../../src/platform/http/app.js';
import type { Principal } from '../../src/platform/http/principal.js';
import { purgeRateLimitCounters } from '../../src/platform/http/rate-limit-store.js';
import { metrics } from '../../src/platform/metrics.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
const apps: FastifyInstance[] = [];
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await ctx.db.destroy();
});

/** A minimal API instance: the caller is taken from a header instead of a token. */
async function apiInstance(db: Db = ctx.db): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('onRequest', (req, _reply, done) => {
    req.principal = { userId: req.headers['x-user'] } as unknown as Principal;
    done();
  });
  await installRateLimit(app, ctx.config, db);
  app.get('/v1/limited', routeLimit(3, '1 minute'), () => ({ ok: true }));
  app.get('/v1/other', routeLimit(3, '1 minute'), () => ({ ok: true }));
  await app.ready();
  apps.push(app);
  return app;
}

const hit = (app: FastifyInstance, user: string, url = '/v1/limited') =>
  app.inject({ url, headers: { 'x-user': user } }).then((r) => r.statusCode);

describe('rate limits shared by every api instance (R13)', () => {
  it('counts one limit across instances, per user and per route', async () => {
    const [a, b] = [await apiInstance(), await apiInstance()];
    const user = `usr_${ulid()}`;
    expect([await hit(a, user), await hit(b, user), await hit(a, user)]).toEqual([200, 200, 200]);
    // The fourth request is over the limit whichever instance receives it.
    expect(await hit(b, user)).toBe(429);
    expect(await hit(a, user)).toBe(429);
    // Other users and other routes have their own counters.
    expect(await hit(b, `usr_${ulid()}`)).toBe(200);
    expect(await hit(b, user, '/v1/other')).toBe(200);
  });

  it('reports the remaining window, measured on the database clock', async () => {
    const a = await apiInstance();
    const user = `usr_${ulid()}`;
    for (let i = 0; i < 3; i++) await hit(a, user);
    const r = await a.inject({ url: '/v1/limited', headers: { 'x-user': user } });
    expect(r.statusCode).toBe(429);
    const retryAfter = Number(r.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(55);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('starts a new window once the previous one has ended', async () => {
    const a = await apiInstance();
    const user = `usr_${ulid()}`;
    for (let i = 0; i < 4; i++) await hit(a, user);
    expect(await hit(a, user)).toBe(429);
    await ctx.db
      .updateTable('rate_limit_counter')
      .set({ window_ends_at: sql<Date>`now() - interval '1 second'` })
      .where('key', 'like', `%:${user}`)
      .execute();
    expect(await hit(a, user)).toBe(200);
    const row = await ctx.db
      .selectFrom('rate_limit_counter')
      .select('count')
      .where('key', 'like', `%:${user}`)
      .executeTakeFirstOrThrow();
    expect(row.count).toBe(1);
  });

  it('removes only counters whose window ended', async () => {
    const [ended, live] = [`test:ended:${ulid()}`, `test:live:${ulid()}`];
    await ctx.db
      .insertInto('rate_limit_counter')
      .values([
        { key: ended, count: 3, window_ends_at: sql<Date>`now() - interval '10 minutes'` },
        { key: live, count: 3, window_ends_at: sql<Date>`now() + interval '10 minutes'` },
      ])
      .execute();
    expect(await purgeRateLimitCounters(ctx.db)).toBeGreaterThanOrEqual(1);
    const left = await ctx.db
      .selectFrom('rate_limit_counter')
      .select('key')
      .where('key', 'in', [ended, live])
      .execute();
    expect(left.map((r) => r.key)).toEqual([live]);
  });

  it('lets requests through and counts the failure when the store is unavailable', async () => {
    // Fail-open by decision (ADR-0020): the same database serves the request itself.
    // Nothing listens on port 1: every counter update fails to connect.
    const broken = createDb('postgres://rabit:rabit@127.0.0.1:1/rabit_test', 1);
    const a = await apiInstance(broken);
    const before = (await metrics.rateLimitStoreErrors.get()).values[0]?.value ?? 0;
    const user = `usr_${ulid()}`;
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push(await hit(a, user));
    expect(codes).toEqual([200, 200, 200, 200, 200]);
    const after = (await metrics.rateLimitStoreErrors.get()).values[0]?.value ?? 0;
    expect(after - before).toBe(5);
    await broken.destroy();
  });
});
