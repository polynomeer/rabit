import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { errors } from '../../platform/errors.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  limitSchema,
  parse,
} from '../../platform/http/validation.js';
import { ANY_ID_PATTERN } from '../../platform/ids.js';
import { playlistView } from '../library/index.js';
import { AXIS_GROUP, type DigAxis } from './connections.js';
import {
  addStep,
  endSession,
  explore,
  getAxes,
  getSession,
  listSessions,
  moveCursor,
  recordAction,
  startSession,
  trailToPlaylist,
  updateSession,
  type DigDeps,
} from './service.js';

const axis = z.enum(Object.keys(AXIS_GROUP) as [DigAxis, ...DigAxis[]]);
const entityParams = z.object({ entity_id: z.string().regex(ANY_ID_PATTERN) });
const sessionParams = z.object({ dig_session_id: idOf('digSession') });

export const digRoutes =
  (deps: DigDeps) =>
  (app: FastifyInstance, ctx: AppContext): void => {
    app.get('/v1/dig/entities/:entity_id/axes', async (req) => {
      requirePrincipal(req.principal);
      const p = entityParams.safeParse(req.params);
      if (!p.success) throw errors.notFound();
      return getAxes(ctx.db, p.data.entity_id);
    });

    app.get('/v1/dig/entities/:entity_id/connections', async (req) => {
      const principal = requirePrincipal(req.principal);
      const p = entityParams.safeParse(req.params);
      if (!p.success) throw errors.notFound();
      const q = parse(
        z.object({
          axis,
          popularity: z.enum(['any', 'below_top_50', 'deep_cuts', 'obscure']).default('any'),
          include_inferred: z
            .enum(['true', 'false'])
            .default('true')
            .transform((v) => v === 'true'),
          limit: limitSchema,
          cursor: z.string().max(512).optional(),
        }),
        req.query,
      );
      return explore(ctx, deps, principal, p.data.entity_id, q);
    });

    app.get('/v1/dig-sessions', async (req) => {
      const p = requirePrincipal(req.principal);
      const q = parse(
        z.object({
          saved: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          limit: limitSchema,
          cursor: z.string().max(512).optional(),
        }),
        req.query,
      );
      return listSessions(ctx, p, q);
    });

    app.post('/v1/dig-sessions', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z
          .strictObject({
            entity_id: z.string().regex(ANY_ID_PATTERN).optional(),
            audio_source_id: idOf('audioSource').optional(),
          })
          .refine((b) => (b.entity_id === undefined) !== (b.audio_source_id === undefined), {
            message: 'exactly one of entity_id or audio_source_id is required',
          }),
        req.body,
      );
      return reply.status(201).send(await startSession(ctx.db, p, body));
    });

    app.get('/v1/dig-sessions/:dig_session_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      return getSession(ctx.db, p, dig_session_id);
    });

    app.patch('/v1/dig-sessions/:dig_session_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z
          .strictObject({
            title: z.string().max(200).nullable().optional(),
            saved: z.boolean().optional(),
          })
          .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' }),
        req.body,
      );
      return updateSession(ctx.db, p, dig_session_id, body);
    });

    app.post('/v1/dig-sessions/:dig_session_id/steps', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z.strictObject({
          from_seq: z.number().int().min(0).optional(),
          entity_id: z.string().regex(ANY_ID_PATTERN),
          axis,
          relation_id: idOf('relation').optional(),
          credit_id: idOf('credit').optional(),
        }),
        req.body,
      );
      const key = idempotencyKeyFrom(req.headers, false);
      const r = await withIdempotency(
        ctx.db,
        { userId: p.userId, operation: `dig.step:${dig_session_id}`, key, request: body },
        async () => ({ status: 201, body: await addStep(ctx.db, p, dig_session_id, body) }),
      );
      return reply.status(r.status).send(r.body);
    });

    app.post('/v1/dig-sessions/:dig_session_id/cursor', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(z.strictObject({ seq: z.number().int().min(0) }), req.body);
      return moveCursor(ctx.db, p, dig_session_id, body.seq);
    });

    app.post('/v1/dig-sessions/:dig_session_id/nodes/:seq/actions', async (req) => {
      const p = requirePrincipal(req.principal);
      const params = parse(
        z.object({ dig_session_id: idOf('digSession'), seq: z.coerce.number().int().min(0) }),
        req.params,
      );
      const body = parse(z.strictObject({ action: z.enum(['played', 'saved']) }), req.body);
      return recordAction(ctx.db, p, params.dig_session_id, params.seq, body.action);
    });

    app.post('/v1/dig-sessions/:dig_session_id/end', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      return endSession(ctx.db, p, dig_session_id);
    });

    app.post('/v1/dig-sessions/:dig_session_id/playlist', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z.strictObject({ title: z.string().trim().min(1).max(200).optional() }),
        req.body ?? {},
      );
      const row = await trailToPlaylist(ctx.db, p, dig_session_id, body.title);
      return reply
        .status(201)
        .header('etag', etag(row.version))
        .send(await playlistView(ctx, deps.catalogAccess, p, row));
    });
  };
