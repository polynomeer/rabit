import type { DbOrTx } from '../../platform/db/db.js';
import type { Principal } from '../../platform/http/principal.js';
import { getSourcesUnchecked } from '../audio/index.js';
import { entitySummaries, recordingSources } from '../catalog/index.js';
import {
  evaluatePolicies,
  type CatalogAccess,
  type DenyReason,
  type PolicyDecision,
} from '../playback/index.js';

export type RefType = 'audio_source' | 'recording' | 'release';
export type Ownership = 'private' | 'audio_log' | 'streaming' | 'purchased' | 'granted';

export interface ResolvedRef {
  title: string | null;
  subtitle: string | null;
  /** Catalog recordings only: their primary release (the artwork key). */
  primary_release_id?: string | null;
  ownership: Ownership | null;
  playability: { playable: boolean; reason: DenyReason | 'no_audio' | 'deleted' | null };
}

const ORIGIN_LABEL = {
  subscription: 'streaming',
  purchase: 'purchased',
  grant: 'granted',
} as const;

const primaryOf = (s: { primary_release_id?: string | null }) =>
  s.primary_release_id === undefined ? {} : { primary_release_id: s.primary_release_id };

const UNRESOLVED = (reason: 'not_found' | 'deleted'): ResolvedRef => ({
  title: null,
  subtitle: null,
  ownership: null,
  playability: { playable: false, reason },
});

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
  return (await resolveRefs(db, catalogAccess, principal, [ref]))[0] as ResolvedRef;
}

/**
 * {@link resolveRef} for a page of references, in input order, with a constant
 * number of queries regardless of the page size (review #6).
 */
export async function resolveRefs(
  db: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  refs: readonly { type: RefType; id: string }[],
): Promise<ResolvedRef[]> {
  const ids = (type: RefType) => refs.filter((r) => r.type === type).map((r) => r.id);
  const releaseIds = ids('release');
  const [privateSources, summaries, tracks] = await Promise.all([
    getSourcesUnchecked(db, ids('audio_source')),
    entitySummaries(db, [...ids('recording'), ...releaseIds]),
    releaseIds.length === 0
      ? Promise.resolve([])
      : db
          .selectFrom('release_track')
          .select(['release_id', 'recording_id'])
          .where('release_id', 'in', [...new Set(releaseIds)])
          .orderBy('release_id')
          .orderBy('disc_no')
          .orderBy('position')
          .execute(),
  ]);
  const tracksOf = new Map<string, string[]>();
  for (const t of tracks)
    tracksOf.set(t.release_id, [...(tracksOf.get(t.release_id) ?? []), t.recording_id]);
  const recordingIdsOf = (ref: { type: RefType; id: string }) =>
    ref.type === 'recording' ? [ref.id] : (tracksOf.get(ref.id) ?? []);

  const catalogSources = await recordingSources(
    db,
    refs.filter((r) => r.type !== 'audio_source' && summaries.has(r.id)).flatMap(recordingIdsOf),
  );
  const liveSourceIds = [...privateSources.values()]
    .filter((s) => s.origin !== 'catalog' && s.deleted_at === null)
    .map((s) => s.id);
  const decisions = await evaluatePolicies(
    db,
    catalogAccess,
    principal,
    [...liveSourceIds, ...catalogSources.values()],
    'play',
  );

  return refs.map((ref): ResolvedRef => {
    if (ref.type === 'audio_source') {
      const src = privateSources.get(ref.id);
      if (!src || src.origin === 'catalog') return UNRESOLVED('not_found');
      if (src.deleted_at !== null) return UNRESOLVED('deleted');
      const d = decisions.get(src.id) as PolicyDecision;
      if (!d.allow && d.reason === 'not_found') return UNRESOLVED('not_found');
      return {
        title: src.title,
        subtitle: src.origin === 'audio_log' ? 'Audio Log' : 'Private audio',
        ownership: src.origin === 'audio_log' ? 'audio_log' : 'private',
        playability: d.allow
          ? { playable: true, reason: null }
          : { playable: false, reason: d.reason },
      };
    }

    const summary = summaries.get(ref.id);
    if (!summary) return UNRESOLVED('not_found');
    let firstDenial: DenyReason | 'no_audio' = 'no_audio';
    for (const recId of recordingIdsOf(ref)) {
      const sourceId = catalogSources.get(recId);
      if (!sourceId) continue;
      const d = decisions.get(sourceId) as PolicyDecision;
      if (d.allow) {
        return {
          title: summary.name,
          subtitle: summary.subtitle,
          ...primaryOf(summary),
          ownership: d.entitlement ? ORIGIN_LABEL[d.entitlement.origin] : 'streaming',
          playability: { playable: true, reason: null },
        };
      }
      if (firstDenial === 'no_audio') firstDenial = d.reason;
    }
    return {
      title: summary.name,
      subtitle: summary.subtitle,
      ...primaryOf(summary),
      ownership: 'streaming',
      playability: { playable: false, reason: firstDenial },
    };
  });
}
