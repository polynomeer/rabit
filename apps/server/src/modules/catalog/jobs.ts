import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { PermanentJobError, type JobHandler } from '../../platform/jobs/runner.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import { getSourceUnchecked, processSource } from '../audio/index.js';
import { expireGrants } from './rights.js';

const payload = z.object({ audio_source_id: z.string(), sha256: z.string() });

/** Catalog masters go through the same validation/transcoding as user audio. */
export function catalogJobs(ctx: AppContext): JobHandler[] {
  return [
    {
      kind: 'catalog.process',
      leaseMs: 30 * 60_000,
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
        });
      },
      async onDead(job, error) {
        const p = payload.parse(job.job.payload);
        await ctx.db
          .updateTable('audio_source')
          .set({
            status: 'failed',
            failure_code: error instanceof PermanentJobError ? error.code : 'PROCESSING_FAILED',
            updated_at: new Date(),
          })
          .where('id', '=', p.audio_source_id)
          .where('status', '=', 'processing')
          .execute();
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
