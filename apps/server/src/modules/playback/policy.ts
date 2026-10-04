import type { DbOrTx } from '../../platform/db/db.js';
import type { Principal } from '../../platform/http/principal.js';
import { metrics } from '../../platform/metrics.js';
import { getSourcesUnchecked, type SourceRow } from '../audio/index.js';
import { workspaceIdsOf } from '../identity/index.js';

export type DenyReason =
  | 'not_found'
  | 'not_ready'
  | 'rights_unavailable'
  | 'subscription_required'
  | 'purchase_available'
  | 'capability_denied';

/** Playback capabilities. MVP has only `play`; offline/stems/transform are P2 (ADR-0016). */
export type Capability = 'play';

export type CatalogDecision =
  | {
      allowed: true;
      rightsGrantId: string;
      rightsVersion: number;
      entitlementId: string;
      entitlementVersion: number;
      entitlementOrigin: 'subscription' | 'purchase' | 'grant';
    }
  | {
      allowed: false;
      reason: 'rights_unavailable' | 'subscription_required' | 'purchase_available';
    };

/**
 * Catalog rights + entitlement check (ADR-0016 steps 4–5), provided by the
 * catalog/entitlement contexts. The territory comes from the server-side account
 * record, never from the request. Evaluates many recordings at once so listings
 * cost a constant number of queries (review #6); every id gets a decision.
 */
export type CatalogAccess = (
  db: DbOrTx,
  principal: Principal,
  recordingIds: readonly string[],
  now: Date,
) => Promise<Map<string, CatalogDecision>>;

export const denyAllCatalog: CatalogAccess = (_db, _principal, recordingIds) =>
  Promise.resolve(
    new Map(recordingIds.map((id) => [id, { allowed: false, reason: 'rights_unavailable' }])),
  );

export type PolicyDecision =
  | {
      allow: true;
      source: SourceRow;
      rights: { grantId: string; version: number } | null;
      entitlement: {
        id: string;
        version: number;
        origin: 'subscription' | 'purchase' | 'grant';
      } | null;
    }
  | { allow: false; reason: DenyReason; source: SourceRow | null };

/**
 * The single playback policy (ADR-0016, authorization.md §3). Used by playback,
 * session refresh, library/playlist availability, DIG playability and search
 * re-checks. Private-source denials collapse to `not_found` (T04/T05).
 */
export async function evaluatePolicy(
  db: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  sourceId: string,
  capability: Capability,
  now = new Date(),
): Promise<PolicyDecision> {
  const decisions = await evaluatePolicies(
    db,
    catalogAccess,
    principal,
    [sourceId],
    capability,
    now,
  );
  return decisions.get(sourceId) as PolicyDecision;
}

/**
 * {@link evaluatePolicy} for many sources with a constant number of queries
 * (review #6). Same steps, same outcomes; every id gets a decision.
 */
export async function evaluatePolicies(
  db: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  sourceIds: readonly string[],
  _capability: Capability,
  now = new Date(),
): Promise<Map<string, PolicyDecision>> {
  const out = new Map<string, PolicyDecision>();
  const decide = (id: string, d: PolicyDecision, origin: string) => {
    metrics.playbackDecisions.inc({ origin, decision: d.allow ? 'allow' : d.reason });
    out.set(id, d);
  };
  const unique = [...new Set(sourceIds)];
  if (unique.length === 0) return out;
  if (principal.status !== 'active') {
    for (const id of unique)
      decide(id, { allow: false, reason: 'not_found', source: null }, 'unknown');
    return out;
  }
  const sources = await getSourcesUnchecked(db, unique);
  const needsMembership = [...sources.values()].some((s) => s.origin !== 'catalog');
  const workspaces = new Set<string>(
    needsMembership ? await workspaceIdsOf(db, principal.userId) : [],
  );

  const pendingCatalog: SourceRow[] = [];
  for (const id of unique) {
    const source = sources.get(id);
    if (!source) {
      decide(id, { allow: false, reason: 'not_found', source: null }, 'unknown');
      continue;
    }
    if (source.origin !== 'catalog') {
      // Step 2: private sources are visible only to workspace members.
      if (!workspaces.has(source.workspace_id) || source.deleted_at !== null)
        decide(id, { allow: false, reason: 'not_found', source: null }, 'private');
      else if (source.status !== 'ready')
        decide(id, { allow: false, reason: 'not_ready', source }, 'private');
      else decide(id, { allow: true, source, rights: null, entitlement: null }, 'private');
      continue;
    }
    // Catalog source.
    if (source.deleted_at !== null)
      decide(id, { allow: false, reason: 'not_found', source: null }, 'catalog');
    else if (source.status !== 'ready')
      decide(id, { allow: false, reason: 'not_ready', source }, 'catalog');
    else if (!source.recording_id)
      decide(id, { allow: false, reason: 'rights_unavailable', source }, 'catalog');
    else pendingCatalog.push(source);
  }

  if (pendingCatalog.length > 0) {
    const access = await catalogAccess(
      db,
      principal,
      pendingCatalog.map((s) => s.recording_id as string),
      now,
    );
    for (const source of pendingCatalog) {
      const a = access.get(source.recording_id as string) ?? {
        allowed: false,
        reason: 'rights_unavailable',
      };
      if (!a.allowed) decide(source.id, { allow: false, reason: a.reason, source }, 'catalog');
      else
        decide(
          source.id,
          {
            allow: true,
            source,
            rights: { grantId: a.rightsGrantId, version: a.rightsVersion },
            entitlement: {
              id: a.entitlementId,
              version: a.entitlementVersion,
              origin: a.entitlementOrigin,
            },
          },
          'catalog',
        );
    }
  }
  return out;
}

/** Playability summary for listings (openapi `Playability`). */
export async function playability(
  db: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  sourceId: string | null,
): Promise<{ playable: boolean; reason: DenyReason | 'no_audio' | 'deleted' | null }> {
  if (!sourceId) return { playable: false, reason: 'no_audio' };
  const d = await evaluatePolicy(db, catalogAccess, principal, sourceId, 'play');
  return d.allow ? { playable: true, reason: null } : { playable: false, reason: d.reason };
}
