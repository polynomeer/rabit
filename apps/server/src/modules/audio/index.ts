import type { Module } from '../../app/modules.js';
import type { AccountDataDeleter } from '../identity/index.js';
import { audioJobs, deleteSourceNow } from './jobs.js';
import { audioRoutes } from './routes.js';
import type { RecordingExists } from './audio-logs.js';
import { markDeleting } from './sources.js';
import type { SupportSection } from '../../platform/support.js';
import { countsBy } from '../../platform/support.js';
import { storageUsage } from './uploads.js';

export {
  getSourceUnchecked,
  getSourcesUnchecked,
  getOwnSource,
  mediaBucket,
  sourceView,
  requestSourceDeletion,
  markDeleting,
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

/** Support summary: storage and processing states of the user's own audio, as counts. */
export const audioSupportSection: SupportSection = {
  name: 'audio',
  async read(db, { workspaceIds }) {
    if (workspaceIds.length === 0) return {};
    const ws = [...workspaceIds];
    const usage = await Promise.all(ws.map((w) => storageUsage(db, w)));
    const [byStatus, failures, uploads] = await Promise.all([
      db
        .selectFrom('audio_source')
        .select((eb) => ['status as k', eb.fn.countAll<number>().as('n')])
        .where('workspace_id', 'in', ws)
        .groupBy('status')
        .execute(),
      db
        .selectFrom('audio_source')
        .select((eb) => ['failure_code as k', eb.fn.countAll<number>().as('n')])
        .where('workspace_id', 'in', ws)
        .where('status', '=', 'failed')
        .groupBy('failure_code')
        .execute(),
      db
        .selectFrom('upload_session')
        .select((eb) => ['state as k', eb.fn.countAll<number>().as('n')])
        .where('workspace_id', 'in', ws)
        .groupBy('state')
        .execute(),
    ]);
    return {
      storage: {
        used_bytes: usage.reduce((a, u) => a + u.usedBytes, 0),
        reserved_bytes: usage.reduce((a, u) => a + u.reservedBytes, 0),
      },
      sources_by_status: countsBy(byStatus),
      failures_by_code: countsBy(failures),
      uploads_by_state: countsBy(uploads),
    };
  },
};
