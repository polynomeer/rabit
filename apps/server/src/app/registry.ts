import { audioModule, storageUsage, deleteAccountAudio } from '../modules/audio/index.js';
import { identityModule } from '../modules/identity/index.js';
import { denyAllCatalog, playbackModule } from '../modules/playback/index.js';
import type { Module } from './modules.js';

/** All bounded-context modules, wired together (composition root). */
export function allModules(): Module[] {
  return [
    identityModule({
      me: {
        storageUsage: (ctx, workspaceId) => storageUsage(ctx.db, workspaceId),
        subscriptionState: () => Promise.resolve('none'),
      },
      accountDeleters: () => [deleteAccountAudio],
    }),
    audioModule({ recordingExists: () => Promise.resolve(false) }),
    playbackModule({
      catalogAccess: denyAllCatalog,
      resolveRecordingSource: () => Promise.resolve(null),
    }),
  ];
}
