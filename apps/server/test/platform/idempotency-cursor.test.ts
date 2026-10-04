import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { CursorCodec } from '../../src/platform/http/cursor.js';
import { withIdempotency } from '../../src/platform/http/idempotency.js';
import { ulid } from '../../src/platform/ids.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

describe('idempotency', () => {
  const scope = (key: string, request: unknown) => ({
    userId: 'usr_test',
    operation: 'test.op',
    key,
    request,
  });

  it('replays the stored response for the same key and body', async () => {
    const key = `k${ulid()}`;
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.resolve({ status: 201, body: { n: calls } });
    };
    const first = await withIdempotency(ctx.db, scope(key, { a: 1 }), fn);
    const second = await withIdempotency(ctx.db, scope(key, { a: 1 }), fn);
    expect(first).toEqual({ status: 201, body: { n: 1 }, replayed: false });
    expect(second).toEqual({ status: 201, body: { n: 1 }, replayed: true });
    expect(calls).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = `k${ulid()}`;
    await withIdempotency(ctx.db, scope(key, { a: 1 }), () =>
      Promise.resolve({ status: 200, body: {} }),
    );
    await expect(
      withIdempotency(ctx.db, scope(key, { a: 2 }), () =>
        Promise.resolve({ status: 200, body: {} }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('releases the key when the operation fails so the client can retry', async () => {
    const key = `k${ulid()}`;
    await expect(
      withIdempotency(ctx.db, scope(key, {}), () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const ok = await withIdempotency(ctx.db, scope(key, {}), () =>
      Promise.resolve({ status: 200, body: { ok: true } }),
    );
    expect(ok.replayed).toBe(false);
  });

  it('reclaims a reservation abandoned by a crashed request (review #10)', async () => {
    const key = `k${ulid()}`;
    await ctx.db
      .insertInto('idempotency_record')
      .values({
        user_id: 'usr_test',
        operation: 'test.op',
        idempotency_key: key,
        request_hash: 'x'.repeat(64),
        response_status: null,
        response_body: null,
      })
      .execute();
    await sql`UPDATE idempotency_record SET created_at = now() - interval '11 minutes' WHERE idempotency_key = ${key}`.execute(
      ctx.db,
    );
    const r = await withIdempotency(ctx.db, scope(key, {}), () =>
      Promise.resolve({ status: 200, body: 'ok' }),
    );
    expect(r).toEqual({ status: 200, body: 'ok', replayed: false });
  });

  it('runs without a key', async () => {
    const r = await withIdempotency(ctx.db, { ...scope('x', {}), key: null }, () =>
      Promise.resolve({ status: 200, body: 1 }),
    );
    expect(r.body).toBe(1);
  });
});

describe('cursor codec (T26)', () => {
  const codec = new CursorCodec('x'.repeat(40));
  const scope = { userId: 'usr_a', query: 'library:all' };

  it('round-trips positions', () => {
    const c = codec.encode(scope, ['2026-10-04T00:00:00Z', 'lib_1']);
    expect(codec.decode(scope, c)).toEqual(['2026-10-04T00:00:00Z', 'lib_1']);
    expect(codec.decode(scope, undefined)).toBeNull();
  });

  it('rejects tampered cursors and cursors from another user or query', () => {
    const c = codec.encode(scope, [1]);
    const [body, sig] = c.split('.');
    const forged = `${Buffer.from(JSON.stringify({ u: 'usr_a', q: 'library:all', p: [999] })).toString('base64url')}.${sig}`;
    expect(() => codec.decode(scope, forged)).toThrow();
    expect(() => codec.decode({ ...scope, userId: 'usr_b' }, c)).toThrow();
    expect(() => codec.decode({ ...scope, query: 'other' }, c)).toThrow();
    expect(() => codec.decode(scope, `${body}`)).toThrow();
  });
});
