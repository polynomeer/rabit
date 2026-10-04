import { createHash } from 'node:crypto';
import type { Db } from '../db/db.js';
import { errors } from '../errors.js';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs `fn` at most once per (user, operation, key) (api-guidelines §5).
 * - same key + same request → stored response replayed
 * - same key + different request → 409 IDEMPOTENCY_KEY_REUSED
 * - concurrent duplicate while the first runs → 409 IDEMPOTENCY_IN_PROGRESS (retryable)
 * If `fn` throws, the reservation is removed so the client can retry.
 */
export async function withIdempotency<T>(
  db: Db,
  scope: { userId: string; operation: string; key: string | null; request: unknown },
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (scope.key === null) {
    const r = await fn();
    return { ...r, replayed: false };
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(scope.request ?? null))
    .digest('hex');
  const inserted = await db
    .insertInto('idempotency_record')
    .values({
      user_id: scope.userId,
      operation: scope.operation,
      idempotency_key: scope.key,
      request_hash: hash,
      response_status: null,
      response_body: null,
    })
    .onConflict((oc) => oc.columns(['user_id', 'operation', 'idempotency_key']).doNothing())
    .executeTakeFirst();

  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) {
    const existing = await db
      .selectFrom('idempotency_record')
      .selectAll()
      .where('user_id', '=', scope.userId)
      .where('operation', '=', scope.operation)
      .where('idempotency_key', '=', scope.key)
      .executeTakeFirst();
    if (!existing) throw errors.idempotencyInProgress();
    if (existing.request_hash !== hash) throw errors.idempotencyReused();
    if (existing.response_status === null) throw errors.idempotencyInProgress();
    return { status: existing.response_status, body: existing.response_body as T, replayed: true };
  }

  try {
    const r = await fn();
    await db
      .updateTable('idempotency_record')
      .set({ response_status: r.status, response_body: JSON.stringify(r.body) })
      .where('user_id', '=', scope.userId)
      .where('operation', '=', scope.operation)
      .where('idempotency_key', '=', scope.key)
      .execute();
    return { ...r, replayed: false };
  } catch (err) {
    await db
      .deleteFrom('idempotency_record')
      .where('user_id', '=', scope.userId)
      .where('operation', '=', scope.operation)
      .where('idempotency_key', '=', scope.key)
      .execute();
    throw err;
  }
}
