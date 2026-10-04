import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import { requireOperator } from '../../platform/http/principal.js';
import { idOf, limitSchema, parse } from '../../platform/http/validation.js';
import { requeueJob, reclaimExpiredLeases } from '../../platform/jobs/queue.js';

type JobRow = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

function jobView(j: JobRow) {
  // Payloads are never returned: they may reference private resources.
  return {
    job_id: j.id,
    kind: j.kind,
    status: j.status,
    attempts: j.attempts,
    max_attempts: j.max_attempts,
    last_error: j.last_error,
    created_at: j.created_at.toISOString(),
    updated_at: j.updated_at.toISOString(),
  };
}

const cols = [
  'id',
  'kind',
  'status',
  'attempts',
  'max_attempts',
  'last_error',
  'created_at',
  'updated_at',
] as const;

/** Operations console API (OPS-010): inspect the DLQ and retry jobs, audited. */
function routes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/ops/jobs', async (req) => {
    requireOperator(req.principal);
    const q = parse(
      z.object({
        status: z.enum(['queued', 'running', 'succeeded', 'failed', 'dead']).optional(),
        limit: limitSchema,
      }),
      req.query,
    );
    let query = ctx.db.selectFrom('job').select(cols).orderBy('updated_at', 'desc').limit(q.limit);
    if (q.status) query = query.where('status', '=', q.status);
    return { items: (await query.execute()).map(jobView) };
  });

  app.post('/v1/ops/jobs/:job_id/retry', async (req) => {
    const op = requireOperator(req.principal);
    const { job_id } = parse(z.object({ job_id: idOf('job') }), req.params);
    const body = parse(z.strictObject({ reason: z.string().min(3).max(500) }), req.body);
    const job = await ctx.db
      .selectFrom('job')
      .select(cols)
      .where('id', '=', job_id)
      .executeTakeFirst();
    if (!job) throw errors.notFound();
    await ctx.db.transaction().execute(async (tx) => {
      if (!(await requeueJob(tx, job_id)))
        throw errors.invalidState('Only dead or failed jobs can be retried.');
      // A retried processing job must find its source in `processing` again.
      if (job.kind === 'audio.process' || job.kind === 'catalog.process') {
        const p = await tx
          .selectFrom('job')
          .select('payload')
          .where('id', '=', job_id)
          .executeTakeFirstOrThrow();
        const sourceId = (p.payload as { audio_source_id?: string }).audio_source_id;
        if (sourceId) {
          await tx
            .updateTable('audio_source')
            .set({ status: 'processing', failure_code: null, updated_at: new Date() })
            .where('id', '=', sourceId)
            .where('status', '=', 'failed')
            .execute();
          await tx
            .updateTable('upload_session')
            .set({ state: 'quarantined', failure_code: null, updated_at: new Date() })
            .where('audio_source_id', '=', sourceId)
            .where('state', '=', 'failed')
            .execute();
        }
      }
      await audit(tx, {
        actorType: 'operator',
        actorId: op.userId,
        action: 'job.retried',
        subjectType: 'job',
        subjectId: job_id,
        reason: body.reason,
        correlationId: req.id,
        details: { kind: job.kind },
      });
    });
    const after = await ctx.db
      .selectFrom('job')
      .select(cols)
      .where('id', '=', job_id)
      .executeTakeFirstOrThrow();
    return jobView(after);
  });
}

export function opsModule(): Module {
  return {
    name: 'ops',
    routes,
    jobs: (ctx) => [
      {
        kind: 'ops.housekeeping',
        leaseMs: 5 * 60_000,
        async handle() {
          await reclaimExpiredLeases(ctx.db);
          // Retention proposals (erd §4): finished jobs 14 d, idempotency records 2 d (≥ 24 h guarantee).
          await ctx.db
            .deleteFrom('job')
            .where('status', '=', 'succeeded')
            .where('updated_at', '<', new Date(Date.now() - 14 * 86_400_000))
            .execute();
          await ctx.db
            .deleteFrom('idempotency_record')
            .where('created_at', '<', new Date(Date.now() - 2 * 86_400_000))
            .execute();
        },
      },
    ],
    schedules: [{ kind: 'ops.housekeeping', everyMs: 60 * 60_000 }],
  };
}
