import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import { parse } from '../../platform/http/validation.js';
import { clientFlags, flagList, isFlagKey, setOverride } from './flags.js';

export { bucket, clearFlagCache, isEnabled, FLAGS, type FlagKey } from './flags.js';

function routes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/features', async (req) => {
    const p = requirePrincipal(req.principal);
    return { features: await clientFlags(ctx.db, p.userId) };
  });

  app.get('/v1/ops/features', async (req) => {
    requireOperator(req.principal);
    return { items: await flagList(ctx.db) };
  });

  app.put('/v1/ops/features/:key', async (req) => {
    const op = requireOperator(req.principal);
    const { key } = parse(z.object({ key: z.string().max(100) }), req.params);
    if (!isFlagKey(key)) throw errors.notFound();
    const body = parse(
      z.strictObject({
        // null clears the override: the code default applies again.
        override: z
          .strictObject({
            enabled: z.boolean(),
            rollout_percent: z.number().int().min(0).max(100),
          })
          .nullable(),
        reason: z.string().min(3).max(500),
      }),
      req.body,
    );
    await setOverride(ctx.db, key, body.override, op.userId);
    await audit(ctx.db, {
      actorType: 'operator',
      actorId: op.userId,
      action: 'feature_flag.changed',
      subjectType: 'feature_flag',
      subjectId: key,
      reason: body.reason,
      correlationId: req.id,
      details: { override: body.override },
    });
    return (await flagList(ctx.db)).find((f) => f.key === (key as string));
  });
}

export function flagsModule(): Module {
  return { name: 'flags', routes };
}
