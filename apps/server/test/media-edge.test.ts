import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaTokenCodec } from '../src/platform/media-token.js';
import { asOperator, seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness } from './helpers/harness.js';

/**
 * CDN edge caching of catalog segments (ADR-0008 amendment 2026-10-20): the
 * CloudFront Function checks the media token, the origin serves what it rewrote.
 */
type EdgeRequest = { uri: string };
type EdgeResult = EdgeRequest | { statusCode: number };

const SECRET = process.env['MEDIA_TOKEN_SECRET']!;
const EDGE_SECRET = process.env['MEDIA_EDGE_SECRET']!;

/** The function's source runs in a fresh context, with the runtime's modules stood in for. */
function loadEdgeFunction(
  secret: string,
): (event: { request: EdgeRequest }) => Promise<EdgeResult> {
  const src = readFileSync(
    new URL('../../../infra/aws/functions/media-edge.js', import.meta.url),
    'utf8',
  ).replace(/^import .*$/gm, '');
  const cf = {
    kvs: () => ({
      get: (k: string) => Promise.resolve(k === 'media-token-secret' ? secret : ''),
    }),
  };
  return new Script(`${src}\nhandler;`).runInNewContext({
    cf,
    crypto: { createHmac },
    Buffer,
  }) as (event: { request: EdgeRequest }) => Promise<EdgeResult>;
}

const handler = loadEdgeFunction(SECRET);
const codec = new MediaTokenCodec(SECRET);
const now = () => Math.floor(Date.now() / 1000);
const prefix = 'asr_01TEST/0123456789abcdef01234567';
const token = (namespace: 'catalog' | 'private', exp = now() + 60) =>
  codec.sign({ sessionId: 'pbs_1', namespace, prefix, exp });
const run = (uri: string) => handler({ request: { uri } });

describe('edge token check (infra/aws/functions/media-edge.js)', () => {
  it('rewrites a catalog segment to its storage path, without the token', async () => {
    expect(await run(`/media/v1/${token('catalog')}/low/seg_00003.m4s`)).toEqual({
      uri: `/media/v1/edge/${prefix}/low/seg_00003.m4s`,
    });
    expect(await run(`/media/v1/${token('catalog')}/init.mp4`)).toEqual({
      uri: `/media/v1/edge/${prefix}/init.mp4`,
    });
  });

  it('leaves private segments to the origin with their token', async () => {
    const uri = `/media/v1/${token('private')}/standard/seg_00000.m4s`;
    expect(await run(uri)).toEqual({ uri });
  });

  it('refuses expired, forged or foreign tokens and anything but segments', async () => {
    const t = token('catalog');
    const [v, body, sig] = t.split('.');
    const forged = `${v}.${body}.${sig!.slice(0, -2)}AA`;
    const other = loadEdgeFunction('another-secret-0123456789abcdef0123456789');
    for (const result of [
      await run(`/media/v1/${token('catalog', now() - 1)}/low/seg_00000.m4s`),
      await run(`/media/v1/${forged}/low/seg_00000.m4s`),
      await other({ request: { uri: `/media/v1/${t}/low/seg_00000.m4s` } }),
      await run(`/media/v1/${t}/master.m3u8`),
      await run(`/media/v1/${t}/low/index.m3u8`),
      await run(`/media/v1/${t}/ultra/seg_00000.m4s`),
      await run(`/media/v1/edge/${prefix}/low/seg_00000.m4s`),
    ]) {
      expect(result).toMatchObject({ statusCode: 403 });
    }
  });
});

describe('edge origin route', () => {
  let h: Harness;
  let base: string;
  beforeAll(async () => {
    h = await createHarness();
    const ops = await asOperator(h);
    const cat = await seedCatalog(h);
    const u = await h.user();
    await ops.setCountry(u, 'KR');
    await ops.subscribe(u);
    const play = await h.api.inject({
      method: 'POST',
      url: '/v1/playback-sessions',
      headers: u.headers,
      payload: { recording_id: cat.ids['r1'], device_id: 'device-edge-1' },
    });
    // What the edge function makes of the session's first low segment.
    const manifest = new URL(play.json<{ manifest_url: string }>().manifest_url).pathname;
    const rewritten = await handler({
      request: { uri: manifest.replace(/master\.m3u8$/, 'low/seg_00000.m4s') },
    });
    if (!('uri' in rewritten)) throw new Error('edge refused a fresh token');
    base = rewritten.uri.replace(/low\/seg_00000\.m4s$/, '');
  });
  afterAll(() => h.close());

  it('serves rewritten catalog segments to the CDN as shared, cacheable bytes', async () => {
    for (const f of ['low/seg_00000.m4s', 'high/init.mp4']) {
      const r = await h.media.inject({
        url: `${base}${f}`,
        headers: { 'x-media-edge': EDGE_SECRET },
      });
      expect(r.statusCode, f).toBe(200);
      expect(r.headers['cache-control']).toBe('public, max-age=86400');
      expect(r.rawPayload.length).toBeGreaterThan(100);
    }
  });

  it('answers only the CDN, and never with a playlist', async () => {
    const seg = `${base}low/seg_00000.m4s`;
    expect((await h.media.inject({ url: seg })).statusCode).toBe(404);
    const wrong = await h.media.inject({
      url: seg,
      headers: { 'x-media-edge': 'x'.repeat(EDGE_SECRET.length) },
    });
    expect(wrong.statusCode).toBe(404);
    for (const f of ['low/index.m3u8', 'master.m3u8', 'low/..%2F..%2Foriginal']) {
      const r = await h.media.inject({
        url: `${base}${f}`,
        headers: { 'x-media-edge': EDGE_SECRET },
      });
      expect(r.statusCode, f).toBe(404);
    }
  });
});
