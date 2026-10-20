import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { PermanentJobError, type JobHandler } from '../../platform/jobs/runner.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import { getSourceUnchecked, markSourceFailed, processSource } from '../audio/index.js';
import { setRecordingDuration } from './entities.js';
import { expireGrants } from './rights.js';

const payload = z.object({ audio_source_id: z.string(), sha256: z.string() });

/** Catalog masters go through the same validation/transcoding as user audio. */
export function catalogJobs(ctx: AppContext): JobHandler[] {
  return [
    {
      kind: 'catalog.process',
      leaseMs: 30 * 60_000,
      pool: 'media',
      // Bulk: user uploads are claimed first.
      priority: 1,
      async handle(job) {
        const p = payload.parse(job.job.payload);
        const source = await getSourceUnchecked(ctx.db, p.audio_source_id);
        if (!source || source.origin !== 'catalog' || source.status !== 'processing') return;
        await processSource(ctx, job, {
          source,
          input: { bucket: BUCKETS.catalogOriginals, key: `${source.storage_prefix}/original` },
          expectedSha256: p.sha256,
          // Catalog masters may be longer than the free-tier cap; 6 h hard limit.
          maxDurationMs: 6 * 60 * 60 * 1000,
          uploadSessionId: null,
          requireLossless: ctx.config.catalog.requireLossless,
          onReady: async (tx, info) => {
            if (source.recording_id)
              await setRecordingDuration(tx, source.recording_id, info.durationMs);
          },
        });
      },
      async onDead(job, error) {
        const p = payload.parse(job.job.payload);
        await markSourceFailed(
          ctx.db,
          p.audio_source_id,
          error instanceof PermanentJobError ? error.code : 'PROCESSING_FAILED',
        );
      },
    },
    {
      kind: 'catalog.expire_grants',
      leaseMs: 60_000,
      async handle() {
        await expireGrants(ctx.db);
      },
    },
  ];
}
