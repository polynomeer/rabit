import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { JobHandler } from '../../platform/jobs/runner.js';
import { revokeSessions } from './sessions.js';

export function playbackJobs(ctx: AppContext): JobHandler[] {
  return [
    {
      kind: 'playback.revoke_for_source',
      leaseMs: 60_000,
      async handle({ job }) {
        const p = z.object({ audio_source_id: z.string() }).parse(job.payload);
        await revokeSessions(ctx.db, { audioSourceId: p.audio_source_id }, 'source_deleted');
      },
    },
    {
      kind: 'playback.expire_sessions',
      leaseMs: 60_000,
      async handle() {
        await ctx.db
          .updateTable('playback_session')
          .set({ status: 'expired' })
          .where('status', '=', 'active')
          .where('expires_at', '<', new Date())
          .execute();
      },
    },
  ];
}
