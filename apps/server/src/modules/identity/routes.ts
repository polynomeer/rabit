import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { errors } from '../../platform/errors.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import { idempotencyKeyFrom, idOf, parse } from '../../platform/http/validation.js';
import {
  getUser,
  quotaPolicy,
  requestAccountDeletion,
  setLicenseCountry,
  FREE_POLICY_ID,
} from './service.js';

export interface MeProviders {
  /** Bytes used and reserved in a workspace (audio module). */
  storageUsage(
    ctx: AppContext,
    workspaceId: string,
  ): Promise<{ usedBytes: number; reservedBytes: number }>;
  /** Current subscription state (entitlement module). */
  subscriptionState(
    ctx: AppContext,
    userId: string,
  ): Promise<'none' | 'active' | 'past_due' | 'cancelled' | 'expired'>;
}

export async function meView(
  ctx: AppContext,
  providers: MeProviders,
  userId: string,
  workspaceId: string,
  isOperator: boolean,
) {
  const user = await getUser(ctx.db, userId as never);
  if (!user) throw errors.notFound();
  const policy = quotaPolicy(ctx.config, FREE_POLICY_ID);
  const usage = await providers.storageUsage(ctx, workspaceId);
  return {
    user_id: user.id,
    status: user.status,
    personal_workspace_id: workspaceId,
    license_country: user.license_country,
    subscription_state: await providers.subscriptionState(ctx, user.id),
    is_operator: isOperator,
    quota: {
      policy_id: policy.id,
      max_total_bytes: policy.maxTotalBytes,
      used_bytes: usage.usedBytes,
      reserved_bytes: usage.reservedBytes,
      max_file_bytes: policy.maxFileBytes,
      max_duration_ms: policy.maxDurationMs,
    },
  };
}

export function identityRoutes(providers: MeProviders) {
  return (app: FastifyInstance, ctx: AppContext) => {
    app.get('/v1/me', async (req) => {
      const p = requirePrincipal(req.principal);
      return meView(ctx, providers, p.userId, p.personalWorkspaceId, p.isOperator);
    });

    app.delete('/v1/me', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const key = idempotencyKeyFrom(req.headers, false);
      const r = await withIdempotency(
        ctx.db,
        { userId: p.userId, operation: 'account.delete', key, request: {} },
        async () => ({ status: 202, body: await requestAccountDeletion(ctx.db, p, req.id) }),
      );
      return reply.status(r.status).send(r.body);
    });

    app.put('/v1/ops/users/:user_id/license-country', async (req) => {
      const op = requireOperator(req.principal);
      const params = parse(z.object({ user_id: idOf('user') }), req.params);
      const body = parse(
        z.strictObject({
          license_country: z.string().regex(/^[A-Z]{2}$/),
          reason: z.string().min(3).max(500),
        }),
        req.body,
      );
      await setLicenseCountry(
        ctx.db,
        op,
        params.user_id,
        body.license_country,
        body.reason,
        req.id,
      );
      const ws = await ctx.db
        .selectFrom('workspace')
        .select('id')
        .where('owner_user_id', '=', params.user_id)
        .where('type', '=', 'personal')
        .executeTakeFirstOrThrow();
      return meView(ctx, providers, params.user_id, ws.id, false);
    });
  };
}
