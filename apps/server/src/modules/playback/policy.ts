import type { DbOrTx } from '../../platform/db/db.js';
import type { Principal } from '../../platform/http/principal.js';
import { metrics } from '../../platform/metrics.js';
import { getSourceUnchecked, type SourceRow } from '../audio/index.js';
import { isWorkspaceMember } from '../identity/index.js';

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
    }
  | {
      allowed: false;
      reason: 'rights_unavailable' | 'subscription_required' | 'purchase_available';
    };

/**
 * Catalog rights + entitlement check (ADR-0016 steps 4–5), provided by the
 * catalog/entitlement contexts. The territory comes from the server-side account
 * record, never from the request.
 */
export type CatalogAccess = (
  db: DbOrTx,
  principal: Principal,
  recordingId: string,
  now: Date,
) => Promise<CatalogDecision>;

export const denyAllCatalog: CatalogAccess = () =>
  Promise.resolve({ allowed: false, reason: 'rights_unavailable' });

export type PolicyDecision =
  | {
      allow: true;
      source: SourceRow;
      rights: { grantId: string; version: number } | null;
      entitlement: { id: string; version: number } | null;
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
  _capability: Capability,
  now = new Date(),
): Promise<PolicyDecision> {
  const decide = (d: PolicyDecision, origin: string): PolicyDecision => {
    metrics.playbackDecisions.inc({ origin, decision: d.allow ? 'allow' : d.reason });
    return d;
  };
  if (principal.status !== 'active')
    return decide({ allow: false, reason: 'not_found', source: null }, 'unknown');
  const source = await getSourceUnchecked(db, sourceId);
  if (!source) return decide({ allow: false, reason: 'not_found', source: null }, 'unknown');

  if (source.origin !== 'catalog') {
    // Step 2: private sources are visible only to workspace members.
    if (!(await isWorkspaceMember(db, principal.userId, source.workspace_id))) {
      return decide({ allow: false, reason: 'not_found', source: null }, 'private');
    }
    if (source.deleted_at !== null)
      return decide({ allow: false, reason: 'not_found', source: null }, 'private');
    if (source.status !== 'ready')
      return decide({ allow: false, reason: 'not_ready', source }, 'private');
    return decide({ allow: true, source, rights: null, entitlement: null }, 'private');
  }

  // Catalog source.
  if (source.deleted_at !== null)
    return decide({ allow: false, reason: 'not_found', source: null }, 'catalog');
  if (source.status !== 'ready')
    return decide({ allow: false, reason: 'not_ready', source }, 'catalog');
  if (!source.recording_id)
    return decide({ allow: false, reason: 'rights_unavailable', source }, 'catalog');
  const access = await catalogAccess(db, principal, source.recording_id, now);
  if (!access.allowed) return decide({ allow: false, reason: access.reason, source }, 'catalog');
  return decide(
    {
      allow: true,
      source,
      rights: { grantId: access.rightsGrantId, version: access.rightsVersion },
      entitlement: { id: access.entitlementId, version: access.entitlementVersion },
    },
    'catalog',
  );
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
