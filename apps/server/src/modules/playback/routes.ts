import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { errors } from '../../platform/errors.js';
import { routeLimit } from '../../platform/http/app.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import { idempotencyKeyFrom, idOf, parse } from '../../platform/http/validation.js';
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
  };
}
