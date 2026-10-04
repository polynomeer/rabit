import { z } from 'zod';
import type { Module } from '../../app/modules.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import type { AccountDataDeleter } from '../identity/index.js';
import type { CatalogAccess } from '../playback/index.js';
import { buildExport, expireExports, type ExportSection } from './export.js';
import { attachUploadToLibrary } from './library.js';
import { libraryRoutes } from './routes.js';

export { createPlaylist, playlistView } from './playlists.js';
export { resolveRef, type Ownership, type ResolvedRef } from './resolve.js';
export type { ExportSection } from './export.js';

export const deleteAccountLibrary: AccountDataDeleter = async (ctx, account) => {
  await ctx.db.deleteFrom('playlist').where('owner_user_id', '=', account.userId).execute();
  await ctx.db.deleteFrom('library_item').where('user_id', '=', account.userId).execute();
  const exports = await ctx.db
    .deleteFrom('export_request')
    .where('user_id', '=', account.userId)
    .returning('object_key')
    .execute();
  for (const e of exports) if (e.object_key) await ctx.blobs.delete(BUCKETS.exports, e.object_key);
};

export function libraryModule(deps: {
  catalogAccess: CatalogAccess;
  exportSections: () => ExportSection[];
}): Module {
  return {
    name: 'library',
    routes: libraryRoutes(deps),
    jobs: (ctx) => [
      {
        kind: 'library.attach_upload',
        leaseMs: 60_000,
        async handle({ job }) {
          const p = z.object({ audio_source_id: z.string() }).parse(job.payload);
          await attachUploadToLibrary(ctx.db, p.audio_source_id);
        },
      },
      {
        kind: 'library.remove_source',
        leaseMs: 60_000,
        async handle({ job }) {
          const p = z.object({ audio_source_id: z.string() }).parse(job.payload);
          // Library entries for deleted audio go away; playlist items stay and show "deleted".
          await ctx.db
            .deleteFrom('library_item')
            .where('ref_type', '=', 'audio_source')
            .where('ref_id', '=', p.audio_source_id)
            .execute();
        },
      },
      {
        kind: 'library.build_export',
        leaseMs: 30 * 60_000,
        async handle({ job }) {
          const p = z.object({ export_id: z.string() }).parse(job.payload);
          await buildExport(ctx, p.export_id, deps.exportSections());
        },
        async onDead({ job }) {
          const p = z.object({ export_id: z.string() }).parse(job.payload);
          await ctx.db
            .updateTable('export_request')
            .set({ state: 'failed', failure_code: 'EXPORT_FAILED', updated_at: new Date() })
            .where('id', '=', p.export_id)
            .execute();
        },
      },
      {
        kind: 'library.expire_exports',
        leaseMs: 5 * 60_000,
        async handle() {
          await expireExports(ctx);
        },
      },
    ],
    subscriptions: {
      AudioReady: ['library.attach_upload'],
      SourceDeleted: ['library.remove_source'],
      ExportRequested: ['library.build_export'],
    },
    schedules: [{ kind: 'library.expire_exports', everyMs: 60 * 60_000 }],
  };
}
