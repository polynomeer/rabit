import type { Module } from '../../app/modules.js';
import { playbackJobs } from './jobs.js';
import { playbackRoutes } from './routes.js';
import { revokeSessions, type PlaybackDeps } from './sessions.js';
import type { AccountDataDeleter } from '../identity/index.js';
import { sql } from 'kysely';
import type { SupportSection } from '../../platform/support.js';
import { countsBy } from '../../platform/support.js';

export {
  evaluatePolicy,
  evaluatePolicies,
  playabilities,
  denyAllCatalog,
  type CatalogAccess,
  type CatalogDecision,
  type DenyReason,
  type Playability,
  type PolicyDecision,
} from './policy.js';
export { computePopularity, tierFor, POPULARITY_POLICY } from './listening.js';
export {
  revokeSessions,
  mediaAccessAllowed,
  denialError,
  type PlaybackDeps,
  type RecordingSourceResolver,
} from './sessions.js';

/** Account deletion: end sessions and remove listening history (privacy.md §2, review #7). */
export const deleteAccountPlayback: AccountDataDeleter = async (ctx, account) => {
  await revokeSessions(ctx.db, { userId: account.userId }, 'account_deleted');
  await ctx.db.deleteFrom('listening_event').where('user_id', '=', account.userId).execute();
};

export function playbackModule(deps: PlaybackDeps): Module {
  return {
    name: 'playback',
    routes: playbackRoutes(deps),
    jobs: playbackJobs,
    subscriptions: {
      SourceDeletionRequested: ['playback.revoke_for_source'],
      RightsGrantChanged: ['playback.revoke_stale_sessions'],
      EntitlementChanged: ['playback.revoke_stale_sessions'],
      LicenseCountryChanged: ['playback.revoke_for_user'],
    },
    schedules: [
      { kind: 'playback.expire_sessions', everyMs: 60_000 },
      { kind: 'playback.compute_popularity', everyMs: 24 * 60 * 60_000 },
      { kind: 'playback.purge_sessions', everyMs: 24 * 60 * 60_000 },
    ],
  };
}

/** Support summary: playback health as counts (no devices, items or listening history). */
export const playbackSupportSection: SupportSection = {
  name: 'playback',
  async read(db, { userId }) {
    const since = sql<Date>`now() - interval '30 days'`;
    const [active, last, revoked, events] = await Promise.all([
      db
        .selectFrom('playback_session')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('user_id', '=', userId)
        .where('status', '=', 'active')
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('playback_session')
        .select(sql<Date | null>`max(issued_at)`.as('at'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('playback_session')
        .select((eb) => ['revoked_reason as k', eb.fn.countAll<number>().as('n')])
        .where('user_id', '=', userId)
        .where('status', '=', 'revoked')
        .where('issued_at', '>', since)
        .groupBy('revoked_reason')
        .execute(),
      db
        .selectFrom('listening_event')
        .select((eb) => ['reject_reason as k', eb.fn.countAll<number>().as('n')])
        .where('user_id', '=', userId)
        .where('received_at', '>', since)
        .groupBy('reject_reason')
        .execute(),
    ]);
    const accepted = events.find((e) => e.k === null)?.n ?? 0;
    return {
      active_sessions: active.n,
      last_session_at: last.at ? new Date(last.at).toISOString() : null,
      revoked_last_30d_by_reason: countsBy(revoked),
      listening_last_30d: {
        accepted,
        rejected_by_reason: countsBy(events.filter((e) => e.k !== null)),
      },
    };
  },
};
