import type { Module } from '../../app/modules.js';
import { playbackJobs } from './jobs.js';
import { playbackRoutes } from './routes.js';
import type { PlaybackDeps } from './sessions.js';

export {
  evaluatePolicy,
  playability,
  denyAllCatalog,
  type CatalogAccess,
  type CatalogDecision,
  type DenyReason,
  type PolicyDecision,
} from './policy.js';
export {
  revokeSessions,
  mediaAccessAllowed,
  denialError,
  type PlaybackDeps,
  type RecordingSourceResolver,
} from './sessions.js';

export function playbackModule(deps: PlaybackDeps): Module {
  return {
    name: 'playback',
    routes: playbackRoutes(deps),
    jobs: playbackJobs,
    subscriptions: { SourceDeletionRequested: ['playback.revoke_for_source'] },
    schedules: [{ kind: 'playback.expire_sessions', everyMs: 60_000 }],
  };
}
