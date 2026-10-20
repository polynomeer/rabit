import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MediaTokenCodec } from '../platform/media-token.js';
import { createHttpApp } from '../platform/http/app.js';
import { metrics } from '../platform/metrics.js';
import { BUCKETS } from '../platform/storage/blob-store.js';
import { HLS_FILE } from '../modules/audio/index.js';
import { mediaAccessAllowed } from '../modules/playback/index.js';
import { readinessChecks, type AppContext } from './context.js';

/**
 * Data-plane gateway (ADR-0008). Verifies the HMAC media token and the live
 * session/source state on every request, then streams bytes from the namespace
 * named by the token. The path can never choose a bucket or escape the prefix.
 */
/** Segments and init segments only: playlists are always checked at the origin. */
const EDGE_FILE = /^((low|standard|high)\/)?(init\.mp4|seg_\d{5}\.m4s)$/;
/** Segment bytes never change under a source's storage prefix. */
const EDGE_MAX_AGE_S = 86_400;

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

  // `:file` or `:rendition/:file` (ADR-0008 ladder); HLS_FILE whitelists both.
  const serve = async (req: FastifyRequest, reply: FastifyReply) => {
    const p = req.params as { token: string; rendition?: string; file: string };
    const { token } = p;
    const file = p.rendition ? `${p.rendition}/${p.file}` : p.file;
    const kind = file.endsWith('.m3u8') ? 'manifest' : 'segment';
    const deny = (status: number, outcome: string) => {
      metrics.mediaRequests.inc({ kind, outcome });
      return reply.status(status).header('cache-control', 'no-store').send();
    };
    if (!HLS_FILE.test(file)) return deny(404, 'bad_path');
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
  };
  app.get('/media/v1/:token/:file', serve);
  app.get('/media/v1/:token/:rendition/:file', serve);

  // Catalog segments the CDN requests after checking the token at the edge
  // (infra/aws/functions/media-edge.js). Shared by every session, so cacheable;
  // playlists never come this way: the session is checked on each of them.
  const edgeSecret = ctx.config.http.mediaEdgeSecret;
  const edge = async (req: FastifyRequest, reply: FastifyReply) => {
    const p = req.params as { source: string; key: string; rendition?: string; file: string };
    const file = p.rendition ? `${p.rendition}/${p.file}` : p.file;
    const deny = (status: number, outcome: string) => {
      metrics.mediaRequests.inc({ kind: 'edge_segment', outcome });
      return reply.status(status).header('cache-control', 'no-store').send();
    };
    const given = Buffer.from(String(req.headers['x-media-edge'] ?? ''));
    const expected = Buffer.from(edgeSecret ?? '');
    if (!edgeSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return deny(404, 'not_edge');
    }
    if (!EDGE_FILE.test(file) || !/^[A-Za-z0-9_]+$/.test(p.source) || !/^[0-9a-f]+$/.test(p.key)) {
      return deny(404, 'bad_path');
    }
    const obj = await ctx.blobs.getStream(BUCKETS.catalogMedia, `${p.source}/${p.key}/hls/${file}`);
    if (!obj) return deny(404, 'missing');
    metrics.mediaRequests.inc({ kind: 'edge_segment', outcome: 'ok' });
    return reply
      .status(200)
      .header('content-type', 'audio/mp4')
      .header('content-length', String(obj.bytes))
      .header('cache-control', `public, max-age=${EDGE_MAX_AGE_S}`)
      .send(obj.body);
  };
  app.get('/media/v1/edge/:source/:key/:file', edge);
  app.get('/media/v1/edge/:source/:key/:rendition/:file', edge);
  return app;
}
