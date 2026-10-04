import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { JobHandler } from '../../platform/jobs/runner.js';
import { computePopularity, purgeListeningEvents } from './listening.js';
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
      kind: 'playback.revoke_for_user',
      leaseMs: 60_000,
      async handle({ job }) {
        const p = z
          .object({ user_id: z.string(), occurred_at: z.iso.datetime().optional() })
          .parse(job.payload);
        // Only sessions authorized under the old territory: a session started after
        // the change, before this job ran, is valid and must keep playing.
        await revokeSessions(
          ctx.db,
          {
            userId: p.user_id,
            ...(p.occurred_at ? { issuedBefore: new Date(p.occurred_at) } : {}),
          },
          'territory_changed',
        );
      },
    },
    {
      // Retention (privacy.md): sessions are kept until their listening events
      // are purged (90 days), then removed.
      kind: 'playback.purge_sessions',
      leaseMs: 10 * 60_000,
      async handle() {
        const cutoff = new Date(Date.now() - 90 * 86_400_000);
        await ctx.db
          .deleteFrom('playback_session')
          .where('expires_at', '<', cutoff)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('listening_event as e')
                  .select('e.id')
                  .whereRef('e.session_id', '=', 'playback_session.id'),
              ),
            ),
          )
          .execute();
      },
    },
    {
      kind: 'playback.compute_popularity',
      leaseMs: 10 * 60_000,
      async handle() {
        await computePopularity(ctx.db);
        await purgeListeningEvents(ctx.db);
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
