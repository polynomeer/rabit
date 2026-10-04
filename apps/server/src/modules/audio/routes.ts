import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { routeLimit } from '../../platform/http/app.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import { idempotencyKeyFrom, idOf, limitSchema, parse } from '../../platform/http/validation.js';
import {
  getOwnSource,
  listOwnSources,
  readWaveform,
  requestSourceDeletion,
  sourceView,
  updateSourceTitle,
} from './sources.js';
import {
  cancelUpload,
  createUploadIntent,
  finalizeUpload,
  getOwnUpload,
  uploadView,
} from './uploads.js';

const createUploadBody = z.strictObject({
  intent: z.enum(['private_upload', 'audio_log']),
  size_bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  filename: z.string().max(255).optional(),
  content_type: z.string().max(100).optional(),
});

export function audioRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/v1/uploads', routeLimit(30, '1 hour'), async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const body = parse(createUploadBody, req.body);
    return reply.status(201).send(await createUploadIntent(ctx, p, body));
  });

  app.get('/v1/uploads/:upload_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { upload_id } = parse(z.object({ upload_id: idOf('upload') }), req.params);
    return uploadView(await getOwnUpload(ctx.db, p, upload_id));
  });

  app.delete('/v1/uploads/:upload_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { upload_id } = parse(z.object({ upload_id: idOf('upload') }), req.params);
    return cancelUpload(ctx, p, upload_id);
  });

  app.post('/v1/uploads/:upload_id/finalize', async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const { upload_id } = parse(z.object({ upload_id: idOf('upload') }), req.params);
    const key = idempotencyKeyFrom(req.headers, true);
    const r = await withIdempotency(
      ctx.db,
      { userId: p.userId, operation: `upload.finalize:${upload_id}`, key, request: {} },
      async () => ({ status: 202, body: await finalizeUpload(ctx, p, upload_id, req.id) }),
    );
    return reply.status(r.status).send(r.body);
  });

  app.get('/v1/audio-sources', async (req) => {
    const p = requirePrincipal(req.principal);
    const q = parse(
      z.object({
        origin: z.enum(['private_upload', 'audio_log']).optional(),
        limit: limitSchema,
        cursor: z.string().max(512).optional(),
      }),
      req.query,
    );
    return listOwnSources(ctx, p, q);
  });

  app.get('/v1/audio-sources/:audio_source_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { audio_source_id } = parse(
      z.object({ audio_source_id: idOf('audioSource') }),
      req.params,
    );
    return sourceView(await getOwnSource(ctx.db, p, audio_source_id), { owner: true });
  });

  app.patch('/v1/audio-sources/:audio_source_id', async (req) => {
    const p = requirePrincipal(req.principal);
    const { audio_source_id } = parse(
      z.object({ audio_source_id: idOf('audioSource') }),
      req.params,
    );
    const body = parse(z.strictObject({ title: z.string().trim().min(1).max(200) }), req.body);
    return updateSourceTitle(ctx.db, p, audio_source_id, body.title);
  });

  app.delete('/v1/audio-sources/:audio_source_id', async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const { audio_source_id } = parse(
      z.object({ audio_source_id: idOf('audioSource') }),
      req.params,
    );
    const view = await ctx.db
      .transaction()
      .execute((tx) => requestSourceDeletion(tx, p, audio_source_id, req.id));
    return reply.status(202).send(view);
  });

  app.get('/v1/audio-sources/:audio_source_id/waveform', async (req) => {
    const p = requirePrincipal(req.principal);
    const { audio_source_id } = parse(
      z.object({ audio_source_id: idOf('audioSource') }),
      req.params,
    );
    return readWaveform(ctx, p, audio_source_id);
  });
}
