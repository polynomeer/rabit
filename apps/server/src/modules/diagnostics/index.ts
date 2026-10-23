import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { routeLimit } from '../../platform/http/app.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import { limitSchema, parse } from '../../platform/http/validation.js';
import {
  diagnosticsBatch,
  errorGroups,
  purgeErrorGroups,
  recordDiagnostics,
} from './diagnostics.js';

export { scrub, fingerprint, MAX_GROUPS } from './diagnostics.js';

function routes(app: FastifyInstance, ctx: AppContext): void {
  // Signed-in clients only (ADR-0027); the caller is not recorded.
  app.post('/v1/client-diagnostics', routeLimit(30, '1 minute'), async (req, reply) => {
    requirePrincipal(req.principal);
    await recordDiagnostics(ctx.db, parse(diagnosticsBatch, req.body));
    return reply.status(204).send();
  });

  // Error groups hold no personal data, so reading them needs no reason.
  app.get('/v1/ops/client-errors', async (req) => {
    requireOperator(req.principal);
    const q = parse(
      z.object({
        platform: z.enum(['web', 'ios']).optional(),
        kind: z.enum(['error', 'unhandled', 'crash', 'hang']).optional(),
        limit: limitSchema,
      }),
      req.query,
    );
    return { items: await errorGroups(ctx.db, q) };
  });
}

export function diagnosticsModule(): Module {
  return {
    name: 'diagnostics',
    routes,
    jobs: (ctx) => [
      {
        kind: 'diagnostics.purge_error_groups',
        leaseMs: 5 * 60_000,
        async handle() {
          await purgeErrorGroups(ctx.db);
        },
      },
    ],
    schedules: [{ kind: 'diagnostics.purge_error_groups', everyMs: 24 * 60 * 60_000 }],
  };
}
