import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/platform/config.js';
import { errors } from '../../src/platform/errors.js';
import { createHttpApp } from '../../src/platform/http/app.js';
import { parse } from '../../src/platform/http/validation.js';
import { createLogger } from '../../src/platform/logger.js';

const app = createHttpApp({
  service: 'api',
  config: loadConfig(),
  log: createLogger({ level: 'silent', name: 'test' }),
  readiness: {
    ok: () => Promise.resolve(),
  },
});
app.get('/boom', () => {
  throw new Error('secret internal detail');
});
app.get('/missing', () => {
  throw errors.notFound();
});
app.post('/strict', (req) => parse(z.strictObject({ a: z.string() }), req.body));

beforeAll(() => app.ready());
afterAll(() => app.close());

describe('http base app', () => {
  it('serves health and readiness', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', checks: { ok: 'ok' } });
  });

  it('returns 503 when a readiness check fails', async () => {
    const failing = createHttpApp({
      service: 'api',
      config: loadConfig(),
      log: createLogger({ level: 'silent', name: 'test' }),
      readiness: { database: () => Promise.reject(new Error('down')) },
    });
    const res = await failing.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database).toBe('down');
    await failing.close();
  });

  it('wraps unknown errors without leaking details', async () => {
    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(body.error.request_id).toBe(res.headers['x-request-id']);
  });

  it('uses the error envelope for app errors and unknown routes', async () => {
    expect((await app.inject('/missing')).json().error.code).toBe('NOT_FOUND');
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects unknown fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/strict',
      payload: { a: 'x', owner_id: 'evil' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts safe request ids and replaces unsafe ones', async () => {
    const ok = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'abc12345-xyz' } });
    expect(ok.headers['x-request-id']).toBe('abc12345-xyz');
    const bad = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'bad id\n' } });
    expect(bad.headers['x-request-id']).toMatch(/^req_/);
  });

  it('sets no-store and nosniff headers', async () => {
    const res = await app.inject('/healthz');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
