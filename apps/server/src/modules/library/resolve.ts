import type { DbOrTx } from '../../platform/db/db.js';
import type { Principal } from '../../platform/http/principal.js';
import { getSourceUnchecked } from '../audio/index.js';
import { entitySummaries, recordingSource } from '../catalog/index.js';
import { evaluatePolicy, type CatalogAccess, type DenyReason } from '../playback/index.js';

export type RefType = 'audio_source' | 'recording' | 'release';
export type Ownership = 'private' | 'audio_log' | 'streaming' | 'purchased' | 'granted';

export interface ResolvedRef {
  title: string | null;
  subtitle: string | null;
  ownership: Ownership | null;
  playability: { playable: boolean; reason: DenyReason | 'no_audio' | 'deleted' | null };
}

const ORIGIN_LABEL = {
  subscription: 'streaming',
  purchase: 'purchased',
  grant: 'granted',
} as const;

/**
 * Resolves library/playlist references at read time. Availability always comes
 * from the playback policy, so entitlement, rights and deletion changes show up
 * immediately and never fail open (PB Phase 13).
 */
export async function resolveRef(
  db: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  ref: { type: RefType; id: string },
): Promise<ResolvedRef> {
  if (ref.type === 'audio_source') {
    const src = await getSourceUnchecked(db, ref.id);
    if (!src || src.origin === 'catalog') {
      return {
        title: null,
        subtitle: null,
        ownership: null,
        playability: { playable: false, reason: 'not_found' },
      };
    }
    if (src.deleted_at !== null) {
      return {
        title: null,
        subtitle: null,
        ownership: null,
        playability: { playable: false, reason: 'deleted' },
      };
    }
    const d = await evaluatePolicy(db, catalogAccess, principal, src.id, 'play');
    if (!d.allow && d.reason === 'not_found') {
      return {
        title: null,
        subtitle: null,
        ownership: null,
        playability: { playable: false, reason: 'not_found' },
      };
    }
    return {
      title: src.title,
      subtitle: src.origin === 'audio_log' ? 'Audio Log' : 'Private audio',
      ownership: src.origin === 'audio_log' ? 'audio_log' : 'private',
      playability: d.allow
        ? { playable: true, reason: null }
        : { playable: false, reason: d.reason },
    };
  }

  const summary = (await entitySummaries(db, [ref.id])).get(ref.id);
  if (!summary) {
    return {
      title: null,
      subtitle: null,
      ownership: null,
      playability: { playable: false, reason: 'not_found' },
    };
  }
  const recordingIds =
    ref.type === 'recording'
      ? [ref.id]
      : (
          await db
            .selectFrom('release_track')
            .select('recording_id')
            .where('release_id', '=', ref.id)
            .orderBy('disc_no')
            .orderBy('position')
            .execute()
        ).map((r) => r.recording_id);

  let firstDenial: DenyReason | 'no_audio' = 'no_audio';
  for (const recId of recordingIds) {
    const sourceId = await recordingSource(db, recId);
    if (!sourceId) continue;
    const d = await evaluatePolicy(db, catalogAccess, principal, sourceId, 'play');
    if (d.allow) {
      return {
        title: summary.name,
        subtitle: summary.subtitle,
        ownership: d.entitlement ? ORIGIN_LABEL[d.entitlement.origin] : 'streaming',
        playability: { playable: true, reason: null },
      };
    }
    if (firstDenial === 'no_audio') firstDenial = d.reason;
  }
  return {
    title: summary.name,
    subtitle: summary.subtitle,
    ownership: 'streaming',
    playability: { playable: false, reason: firstDenial },
  };
}
