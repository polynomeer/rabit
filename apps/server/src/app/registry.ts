import { audioModule, deleteAccountAudio, storageUsage } from '../modules/audio/index.js';
import {
  activeGrant,
  catalogModule,
  recordingExists,
  recordingSource,
} from '../modules/catalog/index.js';
import {
  activePlayEntitlement,
  deleteAccountEntitlements,
  entitlementModule,
  subscriptionState,
} from '../modules/entitlement/index.js';
import { getUser, identityModule } from '../modules/identity/index.js';
import { deleteAccountDig, digExportSection, digModule } from '../modules/dig/index.js';
import { deleteAccountLibrary, libraryModule } from '../modules/library/index.js';
import { deleteAccountSearch, searchModule } from '../modules/search/index.js';
import { playability, playbackModule, type CatalogAccess } from '../modules/playback/index.js';
import type { Module } from './modules.js';

/** Rights ∧ entitlement at access time (ADR-0016 steps 4–5). Territory is server-side only. */
const catalogAccess: CatalogAccess = async (db, principal, recordingId, now) => {
  const user = await getUser(db, principal.userId);
  if (!user?.license_country) return { allowed: false, reason: 'rights_unavailable' };
  const grant = await activeGrant(db, recordingId, user.license_country, 'stream', now);
  if (!grant) return { allowed: false, reason: 'rights_unavailable' };
  const ent = await activePlayEntitlement(db, principal.userId, recordingId, now);
  if (!ent) return { allowed: false, reason: 'subscription_required' };
  return {
    allowed: true,
    rightsGrantId: grant.id,
    rightsVersion: grant.version,
    entitlementId: ent.id,
    entitlementVersion: ent.version,
    entitlementOrigin: ent.origin,
  };
};

/** All bounded-context modules, wired together (composition root). */
export function allModules(): Module[] {
  let ctxDb: Parameters<typeof playability>[0] | null = null;
  return [
    identityModule({
      me: {
        storageUsage: (ctx, workspaceId) => storageUsage(ctx.db, workspaceId),
        subscriptionState: (ctx, userId) => subscriptionState(ctx.db, userId),
      },
      accountDeleters: () => [
        deleteAccountSearch,
        deleteAccountDig,
        deleteAccountAudio,
        deleteAccountLibrary,
        deleteAccountEntitlements,
      ],
    }),
    audioModule({ recordingExists }),
    {
      name: 'catalog-db-capture',
      routes: (_app, ctx) => {
        ctxDb = ctx.db;
      },
    },
    catalogModule({
      playability: (principal, sourceId) => {
        if (!ctxDb) throw new Error('catalog playability used before startup');
        return playability(ctxDb, catalogAccess, principal, sourceId);
      },
    }),
    entitlementModule(),
    playbackModule({ catalogAccess, resolveRecordingSource: recordingSource }),
    libraryModule({ catalogAccess, exportSections: () => [digExportSection] }),
    searchModule(),
    digModule({ catalogAccess, excludedEntities: () => Promise.resolve(new Set<string>()) }),
  ];
}
