import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { ulid } from '../src/platform/ids.js';
import { BUCKETS } from '../src/platform/storage/blob-store.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';

/** Release artwork (ADR-0031): checked, resized, served by signed versioned URLs. */
const run = promisify(execFile);
let h: Harness;
let u: TestUser;
let dir: string;

beforeAll(async () => {
  h = await createHarness();
  u = await h.user();
  dir = await mkdtemp(join(tmpdir(), 'rabit-artwork-'));
});
afterAll(() => h.close());

/** A solid-colour image made with ffmpeg (PNG or JPEG by extension). */
async function image(name: string, w: number, hgt: number) {
  const path = join(dir, name);
  await run(h.ctx.config.worker.ffmpegPath, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x336699:s=${String(w)}x${String(hgt)}`,
    '-frames:v',
    '1',
    '-y',
    path,
  ]);
  return readFile(path);
}

async function releaseWith(cover: Buffer | null) {
  const tag = ulid().slice(-8).toLowerCase();
  const res = await ingestCatalog(
    h.ctx,
    {
      source: `artwork-${tag}`,
      artists: [{ key: 'a', name: `Cover Artist ${tag}` }],
      recordings: [{ key: 'r', title: `Cover Song ${tag}`, artists: ['a'] }],
      releases: [
        {
          key: 'rel',
          title: `Cover Album ${tag}`,
          type: 'album',
          artists: ['a'],
          tracks: ['r'],
          ...(cover ? { cover: 'cover' } : {}),
        },
      ],
    },
    () => (cover ? Promise.resolve(cover) : Promise.reject(new Error('no file'))),
  );
  await h.worker.drain();
  return res.ids['rel'] ?? '';
}

const release = async (id: string) => {
  const r = await h.api.inject({ url: `/v1/releases/${id}`, headers: u.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ artwork: Record<string, string> | null }>();
};

const fetchMedia = (url: string) => h.media.inject({ url: new URL(url).pathname });

describe('release artwork', () => {
  it('serves a delivered cover in three sizes, without metadata, cached for good', async () => {
    const id = await releaseWith(await image('ok.png', 1500, 1500));
    const row = await h.ctx.db
      .selectFrom('release_artwork')
      .selectAll()
      .where('release_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'ready', width: 1500, height: 1500, version: 1 });

    const { artwork } = await release(id);
    expect(Object.keys(artwork ?? {})).toEqual(['300', '600', '1200']);
    const res = await fetchMedia(artwork?.['300'] ?? '');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const out = join(dir, 'served.jpg');
    await writeFile(out, res.rawPayload);
    const probe = await run(h.ctx.config.worker.ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      out,
    ]);
    expect(probe.stdout.trim()).toBe('300,300');
  });

  it('refuses forged tokens and unknown sizes', async () => {
    const id = await releaseWith(await image('ok2.jpg', 800, 800));
    const url = (await release(id)).artwork?.['600'] ?? '';
    expect((await fetchMedia(url)).statusCode).toBe(200);
    const [, , , token] = new URL(url).pathname.split('/');
    const forged = `${String(token).slice(0, -2)}xx`;
    expect((await h.media.inject({ url: `/artwork/v1/${forged}/600.jpg` })).statusCode).toBe(403);
    expect((await h.media.inject({ url: `/artwork/v1/${String(token)}/900.jpg` })).statusCode).toBe(
      404,
    );
  });

  it('keeps the stand-in for covers it cannot use, and says why', async () => {
    const small = await releaseWith(await image('small.png', 400, 400));
    const wide = await releaseWith(await image('wide.png', 900, 600));
    for (const [id, reason] of [
      [small, 'smaller than 600 px'],
      [wide, 'not square'],
    ] as const) {
      expect((await release(id)).artwork).toBeNull();
      const row = await h.ctx.db
        .selectFrom('release_artwork')
        .select(['status', 'failure'])
        .where('release_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: 'failed', failure: reason });
    }
    expect((await release(await releaseWith(null))).artwork).toBeNull();
  });

  it('a new cover is a new version; the old URLs stop', async () => {
    const id = await releaseWith(await image('v1.png', 700, 700));
    const oldUrl = (await release(id)).artwork?.['300'] ?? '';
    const key = `artwork/${ulid().toLowerCase()}/original`;
    await h.ctx.blobs.put(BUCKETS.catalogOriginals, key, await image('v2.png', 900, 900), {
      contentType: 'application/octet-stream',
    });
    const { setArtwork } = await import('../src/modules/catalog/artwork.js');
    await h.ctx.db.transaction().execute((tx) => setArtwork(tx, id, key));
    await h.worker.drain();
    const newUrl = (await release(id)).artwork?.['300'] ?? '';
    expect(newUrl).not.toBe(oldUrl);
    expect((await fetchMedia(newUrl)).statusCode).toBe(200);
    expect((await fetchMedia(oldUrl)).statusCode).toBe(404);
  });

  it('shows covers on release cards', async () => {
    const id = await releaseWith(await image('card.png', 700, 700));
    const { artworkUrls } = await import('../src/modules/catalog/artwork.js');
    const urls = await artworkUrls(h.ctx, [id]);
    expect(urls.get(id)?.['1200']).toMatch(/\/artwork\/v1\/a1\.[^/]+\/1200\.jpg$/);
  });
});
