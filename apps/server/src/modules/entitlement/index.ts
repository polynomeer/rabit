import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  isoTimestamp,
  parse,
  requireIfMatch,
} from '../../platform/http/validation.js';
import type { AccountDataDeleter } from '../identity/index.js';
import {
  changeEntitlementStatus,
  expireEntitlements,
  getSubscription,
  grantEntitlement,
  listEntitlements,
  setSubscription,
  subscriptionView,
} from './service.js';

export { activePlayEntitlement, subscriptionState } from './service.js';

const reason = z.string().min(3).max(500);

function routes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/entitlements', async (req) => {
    const p = requirePrincipal(req.principal);
    return listEntitlements(ctx.db, p.userId);
  });

  app.get('/v1/subscription', async (req) => {
    const p = requirePrincipal(req.principal);
    return subscriptionView(await getSubscription(ctx.db, p.userId));
  });

  app.put('/v1/ops/users/:user_id/subscription', async (req) => {
    const op = requireOperator(req.principal);
    const { user_id } = parse(z.object({ user_id: idOf('user') }), req.params);
    const body = parse(
      z.strictObject({
        plan: z.string().min(1).max(50).default('listen_sandbox'),
        state: z.enum(['active', 'past_due', 'cancelled', 'expired']),
        paid_through: isoTimestamp,
        reason,
      }),
      req.body,
    );
    return setSubscription(ctx.db, op, user_id, body, req.id);
  });

  app.post('/v1/ops/entitlements', async (req, reply) => {
    const op = requireOperator(req.principal);
    const body = parse(
      z.strictObject({
        user_id: idOf('user'),
        scope: z.enum(['release', 'recording']),
        resource_id: z.string().regex(/^(rel|rec)_[0-9A-HJKMNP-TV-Z]{26}$/),
        capabilities: z.array(z.enum(['play'])).min(1),
        valid_to: isoTimestamp.optional(),
        reason,
      }),
      req.body,
    );
    const key = idempotencyKeyFrom(req.headers, true);
    const r = await withIdempotency(
      ctx.db,
      { userId: op.userId, operation: 'ops.entitlement.grant', key, request: body },
      async () => ({ status: 201, body: await grantEntitlement(ctx.db, op, body, req.id) }),
    );
    return reply.status(r.status).header('etag', etag(r.body.version)).send(r.body);
  });

  app.post('/v1/ops/entitlements/:entitlement_id/status', async (req, reply) => {
    const op = requireOperator(req.principal);
    const { entitlement_id } = parse(z.object({ entitlement_id: idOf('entitlement') }), req.params);
    const version = requireIfMatch(req.headers);
    const body = parse(
      z.strictObject({ status: z.enum(['active', 'suspended', 'revoked']), reason }),
      req.body,
    );
    const e = await changeEntitlementStatus(
      ctx.db,
      op,
      entitlement_id,
      version,
      body.status,
      body.reason,
      req.id,
    );
    return reply.header('etag', etag(e.version)).send(e);
  });
}

/** Account deletion: entitlements are revoked; rows stay for legal/ledger traceability (Legal). */
export const deleteAccountEntitlements: AccountDataDeleter = async (ctx, account) => {
  await ctx.db
    .updateTable('entitlement')
    .set((eb) => ({ status: 'revoked', version: eb('version', '+', 1), updated_at: new Date() }))
    .where('user_id', '=', account.userId)
    .where('status', 'in', ['active', 'suspended'])
    .execute();
  await ctx.db
    .updateTable('subscription')
    .set({ state: 'cancelled', updated_at: new Date() })
    .where('user_id', '=', account.userId)
    .execute();
};

export function entitlementModule(): Module {
  return {
    name: 'entitlement',
    routes,
    jobs: (ctx) => [
      {
        kind: 'entitlement.expire',
        leaseMs: 60_000,
        async handle() {
          await expireEntitlements(ctx.db);
        },
      },
    ],
    schedules: [{ kind: 'entitlement.expire', everyMs: 5 * 60_000 }],
  };
}
