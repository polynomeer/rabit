import type { Module } from '../../app/modules.js';
import { playbackJobs } from './jobs.js';
import { playbackRoutes } from './routes.js';
import { revokeSessions, type PlaybackDeps } from './sessions.js';
import type { AccountDataDeleter } from '../identity/index.js';

export {
  evaluatePolicy,
  evaluatePolicies,
  playability,
  denyAllCatalog,
  type CatalogAccess,
  type CatalogDecision,
  type DenyReason,
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
