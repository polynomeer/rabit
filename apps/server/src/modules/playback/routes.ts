import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { errors } from '../../platform/errors.js';
import { routeLimit } from '../../platform/http/app.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import { idempotencyKeyFrom, idOf, isoTimestamp, parse } from '../../platform/http/validation.js';
import { audit } from '../../platform/audit.js';
import { requireOperator } from '../../platform/http/principal.js';
import { recordListeningEvents } from './listening.js';
import { qualityReport, recordQualityReport } from './quality.js';
import {
  addToQueue,
  clearQueue,
  keepItem,
  queueView,
  refreshSuggestions,
  removeItem,
  setCurrent,
  updateSettings,
} from './queue.js';
import { listUsageStatements, usageCsv, usageStatementLines } from './usage.js';
import { createPlaybackSession, refreshPlaybackSession, type PlaybackDeps } from './sessions.js';

const createBody = z
  .strictObject({
    audio_source_id: idOf('audioSource').optional(),
    recording_id: idOf('recording').optional(),
    device_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    desired_quality: z.enum(['auto']).default('auto'),
    mode: z.enum(['original']).default('original'),
  })
  .refine((b) => (b.audio_source_id === undefined) !== (b.recording_id === undefined), {
    message: 'exactly one of audio_source_id or recording_id is required',
  });

export function playbackRoutes(deps: PlaybackDeps) {
  return (app: FastifyInstance, ctx: AppContext) => {
    app.post('/v1/playback-sessions', routeLimit(120, '1 minute'), async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(createBody, req.body);
      const key = idempotencyKeyFrom(req.headers, false);
      const r = await withIdempotency(
        ctx.db,
        { userId: p.userId, operation: 'playback.create', key, request: body },
        async () => ({ status: 201, body: await createPlaybackSession(ctx, deps, p, body) }),
      );
      return reply.status(r.status).send(r.body);
    });

    // One quality report per session (QoE); metrics only.
    app.post(
      '/v1/playback-sessions/:session_id/quality',
      routeLimit(120, '1 minute'),
      async (req, reply) => {
        const p = requirePrincipal(req.principal);
        const params = z.object({ session_id: idOf('playbackSession') }).safeParse(req.params);
        if (!params.success) throw errors.notFound();
        await recordQualityReport(
          ctx.db,
          p,
          params.data.session_id,
          parse(qualityReport, req.body),
        );
        return reply.status(204).send();
      },
    );

    app.post(
      '/v1/playback-sessions/:session_id/refresh',
      routeLimit(120, '1 minute'),
      async (req) => {
        const p = requirePrincipal(req.principal);
        const params = z.object({ session_id: idOf('playbackSession') }).safeParse(req.params);
        if (!params.success) throw errors.notFound();
        return refreshPlaybackSession(ctx, deps, p, params.data.session_id);
      },
    );

    app.post('/v1/listening-events/batch', routeLimit(120, '1 minute'), async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({
          events: z
            .array(
              z.strictObject({
                event_id: z.uuid(),
                session_id: idOf('playbackSession'),
                sequence: z.number().int().min(0),
                type: z.enum(['started', 'heartbeat', 'seek', 'paused', 'ended']),
                position_ms: z.number().int().min(0),
                played_ms: z
                  .number()
                  .int()
                  .min(0)
                  .max(24 * 3600 * 1000),
                client_time: isoTimestamp,
              }),
            )
            .min(1)
            .max(100),
        }),
        req.body,
      );
      return reply.status(202).send(await recordListeningEvents(ctx.db, p, body.events));
    });

    // ---- play queue (ADR-0026) ----
    const queueRef = z.union([
      z.strictObject({ recording_id: idOf('recording') }),
      z.strictObject({ audio_source_id: idOf('audioSource') }),
    ]);
    const itemParams = z.object({ item_id: idOf('queueItem') });

    app.get('/v1/queue', async (req) => queueView(ctx, deps, requirePrincipal(req.principal)));

    app.post('/v1/queue/items', routeLimit(240, '1 minute'), async (req) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({
          items: z.array(queueRef).min(1).max(200),
          placement: z.enum(['now', 'next', 'end']).default('end'),
        }),
        req.body,
      );
      return addToQueue(ctx, deps, p, body);
    });

    app.post('/v1/queue/current', routeLimit(240, '1 minute'), async (req) => {
      const p = requirePrincipal(req.principal);
      const body = parse(z.strictObject({ item_id: idOf('queueItem') }), req.body);
      return setCurrent(ctx, deps, p, body.item_id);
    });

    app.delete('/v1/queue/items/:item_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const params = itemParams.safeParse(req.params);
      if (!params.success) throw errors.notFound();
      return removeItem(ctx, deps, p, params.data.item_id);
    });

    app.post('/v1/queue/items/:item_id/keep', async (req) => {
      const p = requirePrincipal(req.principal);
      const params = itemParams.safeParse(req.params);
      if (!params.success) throw errors.notFound();
      return keepItem(ctx, deps, p, params.data.item_id);
    });

    app.post('/v1/queue/clear', async (req) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({ scope: z.enum(['upcoming', 'suggestions', 'history', 'all']) }),
        req.body,
      );
      return clearQueue(ctx, deps, p, body.scope);
    });

    app.post('/v1/queue/suggestions/refresh', routeLimit(60, '1 minute'), async (req) =>
      refreshSuggestions(ctx, deps, requirePrincipal(req.principal)),
    );

    app.patch('/v1/queue/settings', async (req) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z
          .strictObject({
            mode: z.enum(['queue', 'radio']).optional(),
            autoplay: z.boolean().optional(),
            include_inferred: z.boolean().optional(),
          })
          .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' }),
        req.body,
      );
      return updateSettings(ctx, deps, p, body);
    });

    // Monthly usage statements for rights holders (ADR-0025): operators only.
    app.get('/v1/ops/usage-statements', async (req) => {
      requireOperator(req.principal);
      return { items: await listUsageStatements(ctx.db) };
    });

    app.get('/v1/ops/usage-statements/:month/lines', async (req, reply) => {
      const op = requireOperator(req.principal);
      const { month } = parse(
        z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
        req.params,
      );
      const { format } = parse(
        z.object({ format: z.enum(['json', 'csv']).default('json') }),
        req.query,
      );
      const statements = await listUsageStatements(ctx.db);
      if (!statements.some((s) => s.month === month)) throw errors.notFound();
      const lines = await usageStatementLines(ctx.db, month);
      await audit(ctx.db, {
        actorType: 'operator',
        actorId: op.userId,
        action: 'usage_statement.exported',
        subjectType: 'usage_statement',
        subjectId: month,
        reason: null,
        correlationId: req.id,
        details: { format, lines: lines.length },
      });
      if (format === 'csv') {
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="rabit-usage-${month}.csv"`)
          .send(usageCsv(month, lines));
      }
      return { month, items: lines };
    });
  };
}
