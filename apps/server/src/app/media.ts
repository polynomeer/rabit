import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { MediaTokenCodec } from '../platform/media-token.js';
import { createHttpApp } from '../platform/http/app.js';
import { metrics } from '../platform/metrics.js';
import { BUCKETS } from '../platform/storage/blob-store.js';
import { mediaAccessAllowed } from '../modules/playback/index.js';
import { readinessChecks, type AppContext } from './context.js';

const FILE = /^(index\.m3u8|init\.mp4|seg_\d{5}\.m4s)$/;

/**
 * Data-plane gateway (ADR-0008). Verifies the HMAC media token and the live
 * session/source state on every request, then streams bytes from the namespace
 * named by the token. The path can never choose a bucket or escape the prefix.
 */
export async function buildMediaApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = createHttpApp({
    service: 'media',
    config: ctx.config,
    log: ctx.log,
    readiness: readinessChecks(ctx),
  });
  await app.register(cors, {
    origin: ctx.config.http.corsAllowedOrigins,
    methods: ['GET'],
    maxAge: 600,
  });
  const codec = new MediaTokenCodec(ctx.config.secrets.mediaToken);

  app.get('/media/v1/:token/:file', async (req, reply) => {
    const { token, file } = req.params as { token: string; file: string };
    const kind = file.endsWith('.m3u8') ? 'manifest' : 'segment';
    const deny = (status: number, outcome: string) => {
      metrics.mediaRequests.inc({ kind, outcome });
      return reply.status(status).header('cache-control', 'no-store').send();
    };
    if (!FILE.test(file)) return deny(404, 'bad_path');
    const claims = codec.verify(token);
    if (!claims) return deny(403, 'bad_token');
    if (!(await mediaAccessAllowed(ctx.db, claims))) return deny(403, 'session_inactive');

    const bucket = claims.namespace === 'catalog' ? BUCKETS.catalogMedia : BUCKETS.privateMedia;
    const obj = await ctx.blobs.getStream(bucket, `${claims.prefix}/hls/${file}`);
    if (!obj) return deny(404, 'missing');
    metrics.mediaRequests.inc({ kind, outcome: 'ok' });
    const remaining = Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
    return reply
      .status(200)
      .header('content-type', kind === 'manifest' ? 'application/vnd.apple.mpegurl' : 'audio/mp4')
      .header('content-length', String(obj.bytes))
      .header('cache-control', kind === 'manifest' ? 'no-store' : `private, max-age=${remaining}`)
      .send(obj.body);
  });
  return app;
}
