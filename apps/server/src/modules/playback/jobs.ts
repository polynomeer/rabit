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
      // Sessions issued under an older grant/entitlement version are revoked; the
      // next refresh re-runs the policy (rights checked at access time, ADR-0016).
      kind: 'playback.revoke_stale_sessions',
      leaseMs: 60_000,
      async handle({ job }) {
        const p = z
          .object({
            rights_grant_id: z.string().optional(),
            entitlement_id: z.string().optional(),
            version: z.number().int(),
          })
          .parse(job.payload);
        if (p.rights_grant_id) {
          await revokeSessions(
            ctx.db,
            { rightsGrantId: p.rights_grant_id, belowVersion: p.version },
            'rights_changed',
          );
        }
        if (p.entitlement_id) {
          await revokeSessions(
            ctx.db,
            { entitlementId: p.entitlement_id, belowVersion: p.version },
            'entitlement_changed',
          );
        }
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
