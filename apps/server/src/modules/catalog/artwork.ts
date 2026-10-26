import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { enqueue } from '../../platform/jobs/queue.js';
import { ArtworkTokenCodec } from '../../platform/media-token.js';
import { runProcess } from '../../platform/process.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';

/**
 * Release artwork (ADR-0031). The delivered cover is checked and turned into a few
 * square JPEG sizes, without its metadata (camera data, editing history). Listeners
 * get signed, versioned URLs the media gateway serves; until a cover is ready,
 * clients keep drawing the stand-in cover.
 */
export const ARTWORK_SIZES = [300, 600, 1200] as const;
export type ArtworkSize = (typeof ARTWORK_SIZES)[number];
/** Smaller covers look blurred on phones; DSPs ask for far more (3000 px). */
export const MIN_ARTWORK_PX = 600;
export const MAX_ARTWORK_BYTES = 50 * 1024 ** 2;
const SQUARE_TOLERANCE = 0.02;
const IMAGE_CODECS = new Set(['mjpeg', 'png']);

const mediaKey = (releaseId: string, version: number, size: number) =>
  `artwork/${releaseId}/v${String(version)}/${String(size)}.jpg`;

/** Registers a delivered cover (already stored at `originalKey`) and queues processing. */
export async function setArtwork(tx: DbOrTx, releaseId: string, originalKey: string) {
  const row = await tx
    .insertInto('release_artwork')
    .values({ release_id: releaseId, original_key: originalKey, status: 'processing' })
    .onConflict((oc) =>
      oc.column('release_id').doUpdateSet({
        original_key: originalKey,
        status: 'processing',
        failure: null,
        version: sql<number>`release_artwork.version + 1`,
        updated_at: new Date(),
      }),
    )
    .returning('version')
    .executeTakeFirstOrThrow();
  await enqueue(tx, {
    kind: 'catalog.process_artwork',
    payload: { release_id: releaseId, version: row.version },
    dedupeKey: `artwork:${releaseId}:${String(row.version)}`,
  });
}

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    }),
  ),
});

/** Why a cover was refused; stored for operators, never shown to listeners. */
export async function inspectCover(ffprobePath: string, file: string) {
  const res = await runProcess(
    ffprobePath,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-print_format',
      'json',
      '-show_entries',
      'stream=codec_type,codec_name,width,height',
      file,
    ],
    { timeoutMs: 20_000, maxStdoutBytes: 100_000 },
  );
  if (res.timedOut || res.code !== 0) return { ok: false as const, reason: 'not an image' };
  let parsed;
  try {
    parsed = probeSchema.parse(JSON.parse(res.stdout.toString('utf8')));
  } catch {
    return { ok: false as const, reason: 'unreadable image' };
  }
  const [s, ...rest] = parsed.streams;
  if (!s || rest.length > 0 || s.codec_type !== 'video' || !IMAGE_CODECS.has(s.codec_name ?? '')) {
    return { ok: false as const, reason: 'not a single JPEG or PNG image' };
  }
  const { width = 0, height = 0 } = s;
  if (Math.min(width, height) < MIN_ARTWORK_PX) {
    return { ok: false as const, reason: `smaller than ${String(MIN_ARTWORK_PX)} px` };
  }
  if (Math.abs(width - height) / Math.max(width, height) > SQUARE_TOLERANCE) {
    return { ok: false as const, reason: 'not square' };
  }
  return { ok: true as const, width, height };
}

/** Job: checks the cover and stores its sizes; a stale version or a done one is a no-op. */
export async function processArtwork(ctx: AppContext, releaseId: string, version: number) {
  const row = await ctx.db
    .selectFrom('release_artwork')
    .selectAll()
    .where('release_id', '=', releaseId)
    .executeTakeFirst();
  if (!row || row.version !== version || row.status !== 'processing') return;
  const work = await mkdtemp(join(tmpdir(), 'rabit-artwork-'));
  try {
    const original = join(work, 'original');
    const found = await ctx.blobs.download(BUCKETS.catalogOriginals, row.original_key, original);
    if (!found) throw new Error(`artwork original missing: ${row.original_key}`);
    const { ffmpegPath, ffprobePath } = ctx.config.worker;
    const cover = await inspectCover(ffprobePath, original);
    if (!cover.ok) {
      await finish(ctx.db, releaseId, version, { status: 'failed', failure: cover.reason });
      return;
    }
    for (const size of ARTWORK_SIZES) {
      // Never upscale: a smaller original keeps its size under the larger name.
      const edge = Math.min(size, cover.width, cover.height);
      const out = join(work, `${String(size)}.jpg`);
      const res = await runProcess(
        ffmpegPath,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-i',
          original,
          '-frames:v',
          '1',
          '-vf',
          `scale=${String(edge)}:${String(edge)}:flags=lanczos`,
          '-map_metadata',
          '-1',
          '-q:v',
          '3',
          '-y',
          out,
        ],
        { timeoutMs: 60_000 },
      );
      if (res.timedOut || res.code !== 0) {
        await finish(ctx.db, releaseId, version, { status: 'failed', failure: 'resize failed' });
        return;
      }
      await ctx.blobs.put(
        BUCKETS.catalogMedia,
        mediaKey(releaseId, version, size),
        await readFile(out),
        {
          contentType: 'image/jpeg',
        },
      );
    }
    await finish(ctx.db, releaseId, version, {
      status: 'ready',
      width: cover.width,
      height: cover.height,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function finish(
  db: DbOrTx,
  releaseId: string,
  version: number,
  set: { status: 'ready' | 'failed'; width?: number; height?: number; failure?: string },
) {
  await db
    .updateTable('release_artwork')
    .set({ ...set, updated_at: new Date() })
    .where('release_id', '=', releaseId)
    .where('version', '=', version)
    .execute();
}

/** Signed URLs of each size, for releases with a ready cover. */
export async function artworkUrls(ctx: AppContext, releaseIds: readonly string[]) {
  const out = new Map<string, Record<`${ArtworkSize}`, string>>();
  const unique = [...new Set(releaseIds)];
  if (unique.length === 0) return out;
  const rows = await ctx.db
    .selectFrom('release_artwork')
    .select(['release_id', 'version'])
    .where('release_id', 'in', unique)
    .where('status', '=', 'ready')
    .execute();
  const codec = new ArtworkTokenCodec(ctx.config.secrets.mediaToken);
  const base = ctx.config.http.mediaPublicBaseUrl;
  for (const r of rows) {
    const token = codec.sign(r.release_id, r.version);
    out.set(r.release_id, {
      '300': `${base}/artwork/v1/${token}/300.jpg`,
      '600': `${base}/artwork/v1/${token}/600.jpg`,
      '1200': `${base}/artwork/v1/${token}/1200.jpg`,
    });
  }
  return out;
}

/** For the media gateway: the stored size, when the token's version is the current one. */
export async function artworkObject(db: DbOrTx, releaseId: string, version: number, size: number) {
  const row = await db
    .selectFrom('release_artwork')
    .select(['version', 'status'])
    .where('release_id', '=', releaseId)
    .executeTakeFirst();
  if (!row || row.status !== 'ready' || row.version !== version) return null;
  return { bucket: BUCKETS.catalogMedia, key: mediaKey(releaseId, version, size) };
}
