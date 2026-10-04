import type { Module } from '../../app/modules.js';
import type { AccountDataDeleter } from '../identity/index.js';
import { audioJobs, deleteSourceNow } from './jobs.js';
import { audioRoutes } from './routes.js';
import type { RecordingExists } from './audio-logs.js';
import { markDeleting } from './sources.js';

export {
  getSourceUnchecked,
  getOwnSource,
  mediaBucket,
  sourceView,
  requestSourceDeletion,
  type SourceRow,
} from './sources.js';
export { storageUsage } from './uploads.js';
export { processSource, deleteSourceNow } from './jobs.js';
export type { RecordingExists } from './audio-logs.js';
export { LADDER } from './media/render.js';

/** Account deletion: tombstone and delete every source in the workspace (idempotent). */
export const deleteAccountAudio: AccountDataDeleter = async (ctx, account) => {
  const sources = await ctx.db
    .selectFrom('audio_source')
    .select(['id', 'workspace_id'])
    .where('workspace_id', '=', account.workspaceId)
    .where('status', '!=', 'deleted')
    .execute();
  const now = new Date();
  for (const s of sources) {
    await markDeleting(ctx.db, s.id, s.workspace_id, now, null);
    await deleteSourceNow(ctx, s.id);
  }
  const open = await ctx.db
    .updateTable('upload_session')
    .set({ state: 'cancelled', default_title: null, updated_at: now })
    .where('workspace_id', '=', account.workspaceId)
    .where('state', 'in', ['created', 'uploading', 'quarantined'])
    .returning('quarantine_key')
    .execute();
  for (const o of open) await ctx.blobs.delete('rabit-quarantine', o.quarantine_key);
};

export function audioModule(deps: { recordingExists: RecordingExists }): Module {
  return {
    name: 'audio',
    routes: audioRoutes(deps),
    jobs: audioJobs,
    subscriptions: {
      UploadFinalized: ['audio.process'],
      SourceDeletionRequested: ['audio.delete_source'],
    },
    schedules: [{ kind: 'audio.expire_upload_sessions', everyMs: 5 * 60_000 }],
  };
}
