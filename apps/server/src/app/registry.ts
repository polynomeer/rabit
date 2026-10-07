import {
  audioModule,
  audioSupportSection,
  deleteAccountAudio,
  storageUsage,
} from '../modules/audio/index.js';
import {
  activeGrants,
  catalogModule,
  recordingExists,
  recordingSource,
} from '../modules/catalog/index.js';
import {
  activePlayEntitlements,
  deleteAccountEntitlements,
  entitlementModule,
  entitlementSupportSection,
  subscriptionState,
} from '../modules/entitlement/index.js';
import {
  collectionExportSection,
  collectionModule,
  collectionSupportSection,
  deleteAccountCollection,
} from '../modules/collection/index.js';
import { getUser, identityModule, identitySupportSection } from '../modules/identity/index.js';
import { deleteAccountDig, digExportSection, digModule } from '../modules/dig/index.js';
import {
  deleteAccountLibrary,
  libraryModule,
  librarySupportSection,
} from '../modules/library/index.js';
import { deleteAccountSearch, searchModule } from '../modules/search/index.js';
import {
  excludedEntities,
  integrityModule,
  integritySupportSection,
} from '../modules/integrity/index.js';
import { opsModule } from '../modules/ops/index.js';
import {
  deleteAccountPlayback,
  playabilities,
  playbackModule,
  playbackSupportSection,
  type CatalogAccess,
  type CatalogDecision,
} from '../modules/playback/index.js';
import type { Module } from './modules.js';

/** Rights ∧ entitlement at access time (ADR-0016 steps 4–5). Territory is server-side only. */
export const catalogAccess: CatalogAccess = async (db, principal, recordingIds, now) => {
  const out = new Map<string, CatalogDecision>();
  const user = await getUser(db, principal.userId);
  const country = user?.license_country;
  const grants = country
    ? await activeGrants(db, recordingIds, country, 'stream', now)
    : new Map<string, { id: string; version: number }>();
  const ents = await activePlayEntitlements(
    db,
    principal.userId,
    recordingIds.filter((id) => grants.has(id)),
    now,
  );
  for (const id of recordingIds) {
    const grant = grants.get(id);
    const ent = ents.get(id);
    if (!grant) out.set(id, { allowed: false, reason: 'rights_unavailable' });
    else if (!ent) out.set(id, { allowed: false, reason: 'subscription_required' });
    else
      out.set(id, {
        allowed: true,
        rightsGrantId: grant.id,
        rightsVersion: grant.version,
        entitlementId: ent.id,
        entitlementVersion: ent.version,
        entitlementOrigin: ent.origin,
      });
  }
  return out;
};

/** All bounded-context modules, wired together (composition root). */
export function allModules(): Module[] {
  return [
    identityModule({
      me: {
        storageUsage: (ctx, workspaceId) => storageUsage(ctx.db, workspaceId),
        subscriptionState: (ctx, userId) => subscriptionState(ctx.db, userId),
      },
      accountDeleters: () => [
        deleteAccountSearch,
        deleteAccountPlayback,
        deleteAccountDig,
        deleteAccountCollection,
        deleteAccountAudio,
        deleteAccountLibrary,
        deleteAccountEntitlements,
      ],
    }),
    audioModule({ recordingExists }),
    catalogModule({
      playability: async (db, principal, sourceIds) => {
        const ids = sourceIds.filter((x): x is string => x !== null);
        const byId = await playabilities(db, catalogAccess, principal, ids);
        return sourceIds.map((id) =>
          id === null
            ? { playable: false, reason: 'no_audio' }
            : (byId.get(id) ?? { playable: false, reason: 'not_found' }),
        );
      },
    }),
    entitlementModule(),
    playbackModule({ catalogAccess, resolveRecordingSource: recordingSource }),
    libraryModule({
      catalogAccess,
      exportSections: () => [digExportSection, collectionExportSection],
    }),
    collectionModule(),
    searchModule(),
    integrityModule(),
    opsModule({
      supportSections: () => [
        identitySupportSection,
        entitlementSupportSection,
        audioSupportSection,
        playbackSupportSection,
        librarySupportSection,
        collectionSupportSection,
        integritySupportSection,
      ],
    }),
    digModule({ catalogAccess, excludedEntities }),
  ];
}
