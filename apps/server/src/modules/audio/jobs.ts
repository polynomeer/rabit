import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { newId } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { PermanentJobError, type JobContext, type JobHandler } from '../../platform/jobs/runner.js';
import { metrics } from '../../platform/metrics.js';
import { BUCKETS, type Bucket } from '../../platform/storage/blob-store.js';
import { probe, sniff } from './media/inspect.js';
import { computeWaveform, LADDER, measureLoudness, transcodeHls } from './media/render.js';
import { getSourceUnchecked, mediaBucket, originalsBucket, type SourceRow } from './sources.js';
import { expireUploadSessions } from './uploads.js';

const ENCRYPTION_REF = 'sse-s3'; // ADR-0004: per-workspace KMS keys pending provider decision

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (file.endsWith('.json')) return 'application/json';
  return 'audio/mp4';
}

async function isTombstoned(db: DbOrTx, sourceId: string): Promise<boolean> {
  const row = await db
    .selectFrom('audio_source')
    .select(['deleted_at'])
    .where('id', '=', sourceId)
    .executeTakeFirst();
  return !row || row.deleted_at !== null;
}

async function upsertAsset(
  db: DbOrTx,
  a: {
    sourceId: string;
    kind: 'original' | 'hls' | 'waveform';
    bucket: Bucket;
    key: string;
    sha256: string | null;
    bytes: number;
    codec: string | null;
    toolVersion: string | null;
  },
): Promise<void> {
  await db
    .insertInto('audio_asset')
    .values({
      id: newId('audioAsset'),
      audio_source_id: a.sourceId,
      kind: a.kind,
      bucket: a.bucket,
      object_key: a.key,
      sha256: a.sha256,
      bytes: a.bytes,
      codec: a.codec,
      tool_version: a.toolVersion,
      encryption_key_ref: ENCRYPTION_REF,
    })
    .onConflict((oc) =>
      oc.columns(['audio_source_id', 'kind']).doUpdateSet({
        bucket: a.bucket,
        object_key: a.key,
        sha256: a.sha256,
        bytes: a.bytes,
        codec: a.codec,
        tool_version: a.toolVersion,
      }),
    )
    .execute();
}

/** Where the bytes to process come from: a user upload (quarantine) or catalog ingest. */
export interface ProcessInput {
  source: SourceRow;
  input: { bucket: Bucket; key: string };
  expectedSha256: string;
  maxDurationMs: number;
  uploadSessionId: string | null;
}

/**
 * Validates, transcodes, analyzes and stores one source. Idempotent: object keys
 * are deterministic per source, assets are upserted, and the tombstone is checked
 * before every write so a concurrent delete wins (T16).
 */
export async function processSource(
  ctx: AppContext,
  job: JobContext,
  p: ProcessInput,
): Promise<void> {
  const { source } = p;
  const work = await mkdtemp(join(tmpdir(), 'rabit-'));
  const log = job.log.child({ audio_source_id: source.id });
  try {
    const inputPath = join(work, 'input');
    if (!(await ctx.blobs.download(p.input.bucket, p.input.key, inputPath))) {
      throw new PermanentJobError('UPLOAD_MISSING');
    }
    const size = (await stat(inputPath)).size;
    if ((await sha256File(inputPath)) !== p.expectedSha256)
      throw new PermanentJobError('CHECKSUM_MISMATCH');
    if (!(await sniff(inputPath))) throw new PermanentJobError('UNSUPPORTED_MEDIA', 'magic bytes');

    const probed = await probe(ctx.config.worker.ffprobePath, inputPath, {
      maxDurationMs: p.maxDurationMs,
      signal: job.signal,
    });
    if (!probed.ok) throw new PermanentJobError(probed.failure, probed.reason);
    const info = probed.result;

    const hls = await transcodeHls(ctx.config.worker.ffmpegPath, inputPath, work, {
      durationMs: info.durationMs,
      signal: job.signal,
    });
    if (!hls.ok) {
      if (job.signal.aborted) throw new Error('aborted');
      throw new PermanentJobError(hls.timedOut ? 'TRANSCODE_TIMEOUT' : 'TRANSCODE_FAILED');
    }

    // Analysis never blocks playback (audio-pipeline §2): failures are logged and skipped.
    const loudness = await measureLoudness(ctx.config.worker.ffmpegPath, inputPath, {
      durationMs: info.durationMs,
      signal: job.signal,
    }).catch(() => null);
    const waveform = await computeWaveform(ctx.config.worker.ffmpegPath, inputPath, {
      durationMs: info.durationMs,
      signal: job.signal,
    }).catch(() => null);
    if (!loudness) log.warn('loudness analysis unavailable');
    if (!waveform) log.warn('waveform analysis unavailable');

    if (await isTombstoned(ctx.db, source.id)) return;
    const prefix = source.storage_prefix;
    const origBucket = originalsBucket(source.origin);
    const media = mediaBucket(source.origin);
    if (p.input.bucket === BUCKETS.quarantine || p.input.bucket !== origBucket) {
      await ctx.blobs.copy(p.input, { bucket: origBucket, key: `${prefix}/original` });
    }
    for (const f of hls.output.files) {
      if (await isTombstoned(ctx.db, source.id)) return;
      const path = join(hls.output.dir, f);
      await ctx.blobs.put(media, `${prefix}/hls/${f}`, createReadStream(path), {
        contentType: contentTypeFor(f),
        bytes: (await stat(path)).size,
      });
    }
    if (waveform) {
      const body = Buffer.from(
        JSON.stringify({
          samples_per_peak: waveform.samplesPerPeak,
          sample_rate: waveform.sampleRate,
          peaks: waveform.peaks,
        }),
      );
      await ctx.blobs.put(media, `${prefix}/waveform.json`, body, {
        contentType: 'application/json',
        bytes: body.length,
      });
    }

    const tombstoned = await ctx.db.transaction().execute(async (tx) => {
      const locked = await tx
        .selectFrom('audio_source')
        .select(['status', 'deleted_at'])
        .where('id', '=', source.id)
        .forUpdate()
        .executeTakeFirst();
      if (!locked || locked.deleted_at !== null) return true;
      await upsertAsset(tx, {
        sourceId: source.id,
        kind: 'original',
        bucket: origBucket,
        key: `${prefix}/original`,
        sha256: p.expectedSha256,
        bytes: size,
        codec: info.codec,
        toolVersion: null,
      });
      const hlsBytes = await Promise.all(
        hls.output.files.map(async (f) => (await stat(join(hls.output.dir, f))).size),
      );
      await upsertAsset(tx, {
        sourceId: source.id,
        kind: 'hls',
        bucket: media,
        key: `${prefix}/hls/`,
        sha256: null,
        bytes: hlsBytes.reduce((a, b) => a + b, 0),
        codec: `${LADDER.codec}/${LADDER.bitrateKbps}k`,
        toolVersion: `ffmpeg ${hls.output.toolVersion}`,
      });
      if (waveform) {
        await upsertAsset(tx, {
          sourceId: source.id,
          kind: 'waveform',
          bucket: media,
          key: `${prefix}/waveform.json`,
          sha256: null,
          bytes: waveform.peaks.length,
          codec: null,
          toolVersion: `ffmpeg ${hls.output.toolVersion}`,
        });
      }
      await tx
        .updateTable('audio_version')
        .set({
          duration_ms: info.durationMs,
          technical: JSON.stringify({
            sample_rate: info.sampleRate,
            channels: info.channels,
            codec: info.codec,
            container: info.container,
            ...(loudness
              ? { integrated_lufs: loudness.integratedLufs, true_peak_dbtp: loudness.truePeakDbtp }
              : {}),
          }),
        })
        .where('id', '=', source.audio_version_id)
        .execute();
      await tx
        .updateTable('audio_source')
        .set({ status: 'ready', failure_code: null, updated_at: new Date() })
        .where('id', '=', source.id)
        .execute();
      if (p.uploadSessionId) {
        await tx
          .updateTable('upload_session')
          .set({ state: 'ready', updated_at: new Date() })
          .where('id', '=', p.uploadSessionId)
          .execute();
      }
      await emit(tx, {
        type: 'AudioReady',
        schemaVersion: 1,
        subjectId: source.id,
        workspaceId: source.workspace_id,
        privacyScope: source.origin === 'catalog' ? 'catalog' : 'private',
        correlationId: job.job.correlationId,
        payload: {
          audio_source_id: source.id,
          audio_version_id: source.audio_version_id,
          origin: source.origin,
        },
      });
      return false;
    });
    if (tombstoned) {
      // Deleted while we were writing: remove whatever we wrote (the delete job also sweeps).
      await deleteSourceObjects(ctx, source);
      return;
    }
    if (p.input.bucket === BUCKETS.quarantine) await ctx.blobs.delete(p.input.bucket, p.input.key);
    metrics.uploads.inc({ event: 'ready' });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function deleteSourceObjects(
  ctx: AppContext,
  source: Pick<SourceRow, 'storage_prefix' | 'origin'>,
) {
  await ctx.blobs.deletePrefix(originalsBucket(source.origin), `${source.storage_prefix}/`);
  await ctx.blobs.deletePrefix(mediaBucket(source.origin), `${source.storage_prefix}/`);
}

const processPayload = z.object({ audio_source_id: z.string(), upload_session_id: z.string() });

async function markFailed(
  ctx: AppContext,
  sourceId: string,
  uploadSessionId: string,
  code: string,
) {
  await ctx.db.transaction().execute(async (tx) => {
    const res = await tx
      .updateTable('audio_source')
      .set({ status: 'failed', failure_code: code, updated_at: new Date() })
      .where('id', '=', sourceId)
      .where('status', '=', 'processing')
      .returning(['workspace_id'])
      .executeTakeFirst();
    // Terminal upload state releases the quota reservation.
    await tx
      .updateTable('upload_session')
      .set({ state: 'failed', failure_code: code, updated_at: new Date() })
      .where('id', '=', uploadSessionId)
      .where('state', 'in', ['quarantined', 'processing'])
      .execute();
    if (res) {
      await emit(tx, {
        type: 'AudioProcessingFailed',
        schemaVersion: 1,
        subjectId: sourceId,
        workspaceId: res.workspace_id,
        privacyScope: 'private',
        payload: { audio_source_id: sourceId, failure_code: code },
      });
    }
  });
  metrics.uploads.inc({ event: 'failed' });
}

export function audioJobs(ctx: AppContext): JobHandler[] {
  return [
    {
      kind: 'audio.process',
      leaseMs: 30 * 60_000,
      async handle(job) {
        const p = processPayload.parse(job.job.payload);
        const source = await getSourceUnchecked(ctx.db, p.audio_source_id);
        const session = await ctx.db
          .selectFrom('upload_session')
          .selectAll()
          .where('id', '=', p.upload_session_id)
          .executeTakeFirst();
        if (!source || !session) return;
        if (source.deleted_at !== null || source.status !== 'processing') {
          if (source.deleted_at !== null)
            await ctx.blobs.delete(BUCKETS.quarantine, session.quarantine_key);
          return; // already processed, failed, or deleted
        }
        await ctx.db
          .updateTable('upload_session')
          .set({ state: 'processing', updated_at: new Date() })
          .where('id', '=', session.id)
          .where('state', '=', 'quarantined')
          .execute();
        await processSource(ctx, job, {
          source,
          input: { bucket: BUCKETS.quarantine, key: session.quarantine_key },
          expectedSha256: session.declared_sha256,
          maxDurationMs: ctx.config.quota.maxDurationMs,
          uploadSessionId: session.id,
        });
      },
      async onDead(job, error) {
        const p = processPayload.parse(job.job.payload);
        const code = error instanceof PermanentJobError ? error.code : 'PROCESSING_FAILED';
        await markFailed(ctx, p.audio_source_id, p.upload_session_id, code);
        const session = await ctx.db
          .selectFrom('upload_session')
          .select('quarantine_key')
          .where('id', '=', p.upload_session_id)
          .executeTakeFirst();
        if (session) await ctx.blobs.delete(BUCKETS.quarantine, session.quarantine_key);
      },
    },
    {
      kind: 'audio.delete_source',
      leaseMs: 10 * 60_000,
      async handle(job) {
        const p = z.object({ audio_source_id: z.string() }).parse(job.job.payload);
        await deleteSourceNow(ctx, p.audio_source_id);
      },
    },
    {
      kind: 'audio.expire_upload_sessions',
      leaseMs: 5 * 60_000,
      async handle(job) {
        const n = await expireUploadSessions(ctx);
        if (n > 0) job.log.info({ expired: n }, 'expired upload sessions');
      },
    },
  ];
}

/**
 * Removes every object under the source prefix (not only known asset rows), the
 * asset rows and personal metadata, then marks the source `deleted`. Idempotent.
 */
export async function deleteSourceNow(ctx: AppContext, sourceId: string): Promise<void> {
  const source = await getSourceUnchecked(ctx.db, sourceId);
  if (!source || source.status === 'deleted') return;
  if (source.deleted_at === null) throw new Error('source is not tombstoned');
  await deleteSourceObjects(ctx, source);
  const sessions = await ctx.db
    .selectFrom('upload_session')
    .select('quarantine_key')
    .where('audio_source_id', '=', sourceId)
    .execute();
  for (const s of sessions) await ctx.blobs.delete(BUCKETS.quarantine, s.quarantine_key);
  await ctx.db.transaction().execute(async (tx) => {
    await tx.deleteFrom('audio_asset').where('audio_source_id', '=', sourceId).execute();
    await tx
      .updateTable('upload_session')
      .set({ default_title: null, updated_at: new Date() })
      .where('audio_source_id', '=', sourceId)
      .execute();
    await tx
      .updateTable('audio_source')
      .set({ status: 'deleted', title: null, updated_at: new Date() })
      .where('id', '=', sourceId)
      .execute();
    await emit(tx, {
      type: 'SourceDeleted',
      schemaVersion: 1,
      subjectId: sourceId,
      workspaceId: source.workspace_id,
      privacyScope: 'private',
      payload: { audio_source_id: sourceId },
    });
  });
}
