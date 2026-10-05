import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { routeLimit } from '../../platform/http/app.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import { idOf, limitSchema, parse } from '../../platform/http/validation.js';
import { ANY_ID_PATTERN } from '../../platform/ids.js';
import { countsBy, type SupportSection } from '../../platform/support.js';
import {
  changeReportStatus,
  listReports,
  passport,
  recordSignal,
  submitReport,
} from './service.js';

export { excludedEntities } from './service.js';

const reason = z.string().min(3).max(500);

function routes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/recordings/:recording_id/passport', async (req) => {
    requirePrincipal(req.principal);
    const { recording_id } = parse(z.object({ recording_id: idOf('recording') }), req.params);
    return passport(ctx.db, recording_id, ctx.config.http.apiPublicBaseUrl);
  });

  app.post('/v1/reports', routeLimit(20, '1 hour'), async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const body = parse(
      z.strictObject({
        subject_type: z.enum(['recording', 'release', 'artist', 'relation', 'credit']),
        subject_id: z.string().regex(ANY_ID_PATTERN),
        reason_code: z.enum([
          'wrong_credit',
          'wrong_relation',
          'undisclosed_ai',
          'spam',
          'impersonation',
          'rights_infringement',
          'other',
        ]),
        details: z.string().max(2000).optional(),
      }),
      req.body,
    );
    return reply.status(201).send(await submitReport(ctx.db, p, body, req.id));
  });

  app.get('/v1/ops/reports', async (req) => {
    requireOperator(req.principal);
    const q = parse(
      z.object({
        status: z.enum(['received', 'triaged', 'actioned', 'dismissed']).optional(),
        limit: limitSchema,
      }),
      req.query,
    );
    return listReports(ctx.db, q.status, q.limit);
  });

  app.post('/v1/ops/reports/:report_id/status', async (req) => {
    const op = requireOperator(req.principal);
    const { report_id } = parse(z.object({ report_id: idOf('report') }), req.params);
    const body = parse(
      z.strictObject({ status: z.enum(['triaged', 'actioned', 'dismissed']), reason }),
      req.body,
    );
    return changeReportStatus(ctx.db, op, report_id, body.status, body.reason, req.id);
  });

  app.post('/v1/ops/integrity-signals', async (req, reply) => {
    const op = requireOperator(req.principal);
    const body = parse(
      z.strictObject({
        subject_entity_id: z.string().regex(ANY_ID_PATTERN),
        axis: z.enum([
          'ai_generation',
          'technical_quality',
          'spam_risk',
          'rights_status',
          'recommendation_eligibility',
        ]),
        value: z.string().min(1).max(50),
        reason,
      }),
      req.body,
    );
    return reply.status(201).send(await recordSignal(ctx.db, op, body, req.id));
  });
}

export function integrityModule(): Module {
  return { name: 'integrity', routes };
}

/** Support summary: reports the user filed, by status (no report text). */
export const integritySupportSection: SupportSection = {
  name: 'reports',
  async read(db, { userId }) {
    const rows = await db
      .selectFrom('report')
      .select((eb) => ['status as k', eb.fn.countAll<number>().as('n')])
      .where('reporter_user_id', '=', userId)
      .groupBy('status')
      .execute();
    return { filed_by_status: countsBy(rows) };
  },
};
