import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { DigEvidence, RelationType } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { entitySummaries, recordingSources, type EntitySummary } from '../catalog/index.js';
import { playabilities, type Playability } from '../playback/index.js';
import type { DigDeps } from './service.js';

/**
 * Original-song lineage (DIG-003, TRU-005): from one recording, the songs it comes from
 * (samples, covers, remixes of) and the songs that come from it, up to two steps each
 * way. Read from stored relations only; each edge carries its provenance, and a
 * relation never implies permission (DIG-018).
 */
export const LINEAGE_TYPES = ['samples', 'covers', 'remix_of'] as const satisfies RelationType[];
export type LineageType = (typeof LINEAGE_TYPES)[number];

/** Bounds keep one graph cheap to draw and to read. */
const PER_STEP = 50;
const MAX_NODES = 200;

type Side = 'origin' | 'derived';

interface RelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: LineageType;
  basis: DigEvidence['basis'];
  verification_state: DigEvidence['verification_state'];
  source: string;
  confidence: number | null;
  license_status: 'unknown' | 'licensed' | 'not_applicable';
}

/**
 * Relations touching `ids` on one side. A stored relation points from the derived
 * recording to the original (`from` samples/covers/remixes `to`), so origins are found
 * through `from` and derivatives through `to`.
 */
async function step(
  db: DbOrTx,
  ids: readonly string[],
  side: Side,
  includeInferred: boolean,
): Promise<RelationRow[]> {
  if (ids.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  let q = db
    .selectFrom('music_relation')
    .select([
      'id',
      'from_entity_id',
      'to_entity_id',
      'relation_type',
      'basis',
      'verification_state',
      'source',
      'confidence',
      'license_status',
    ])
    .where('relation_type', 'in', LINEAGE_TYPES)
    .where(side === 'origin' ? 'from_entity_id' : 'to_entity_id', 'in', ids)
    .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', today)]))
    .orderBy('id')
    .limit(PER_STEP * ids.length);
  if (!includeInferred) q = q.where('basis', '!=', 'ml_inferred');
  return (await q.execute()) as RelationRow[];
}

/** How many recordings are derived from each of `ids`, for the "+N more" hint. */
async function derivativeCounts(
  db: DbOrTx,
  ids: readonly string[],
  includeInferred: boolean,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  let q = db
    .selectFrom('music_relation')
    .select(['to_entity_id', (eb) => eb.fn.count<number>('from_entity_id').distinct().as('n')])
    .where('relation_type', 'in', LINEAGE_TYPES)
    .where('to_entity_id', 'in', ids)
    .groupBy('to_entity_id');
  if (!includeInferred) q = q.where('basis', '!=', 'ml_inferred');
  const rows = await q.execute();
  return new Map(rows.map((r) => [r.to_entity_id, r.n]));
}

function evidence(r: RelationRow, derived: string, original: string): DigEvidence {
  return {
    basis: r.basis,
    verification_state: r.verification_state,
    source: r.source,
    confidence: r.confidence,
    // The relation fact and its license are separate (DIG-018, rights-model §2.4).
    license_status: r.license_status,
    explanation: `${derived} ${r.relation_type === 'samples' ? 'samples' : r.relation_type === 'covers' ? 'is a cover of' : 'is a remix of'} ${original}`,
    reason: { code: `lineage.${r.relation_type}`, params: { derived, original } },
  };
}

export async function lineageOf(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  recordingId: string,
  q: { depth: 1 | 2; include_inferred: boolean },
) {
  const root = (await entitySummaries(ctx.db, [recordingId])).get(recordingId);
  if (root?.entity_type !== 'recording') throw errors.notFound();

  const placed = new Map<string, { side: Side; depth: number }>([
    [recordingId, { side: 'origin', depth: 0 }],
  ]);
  const edges = new Map<string, RelationRow>();
  let truncated = false;
  for (const side of ['origin', 'derived'] as const) {
    let frontier = [recordingId];
    for (let depth = 1; depth <= q.depth && frontier.length > 0; depth += 1) {
      const rows = await step(ctx.db, frontier, side, q.include_inferred);
      const next: string[] = [];
      for (const r of rows) {
        const other = side === 'origin' ? r.to_entity_id : r.from_entity_id;
        if (!placed.has(other)) {
          if (placed.size >= MAX_NODES) {
            truncated = true;
            continue;
          }
          placed.set(other, { side, depth });
          next.push(other);
        }
        edges.set(r.id, r);
      }
      frontier = next;
    }
  }

  // Music Integrity exclusions (DIG-020) apply here as in every DIG result.
  const excluded = await deps.excludedEntities(ctx.db, [...placed.keys()]);
  excluded.delete(recordingId);
  for (const id of excluded) placed.delete(id);
  let kept = [...edges.values()].filter(
    (e) => placed.has(e.from_entity_id) && placed.has(e.to_entity_id),
  );
  // A node reached only through an excluded one would float free: keep what still
  // connects to the root.
  const reached = new Set([recordingId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of kept) {
      const a = reached.has(e.from_entity_id);
      const b = reached.has(e.to_entity_id);
      if (a !== b) {
        reached.add(a ? e.to_entity_id : e.from_entity_id);
        grew = true;
      }
    }
  }
  for (const id of [...placed.keys()]) if (!reached.has(id)) placed.delete(id);
  kept = kept.filter((e) => reached.has(e.from_entity_id) && reached.has(e.to_entity_id));

  const ids = [...placed.keys()];
  const summaries = await entitySummaries(ctx.db, ids);
  const sources = await recordingSources(ctx.db, ids);
  const playable = await playabilities(ctx.db, deps.catalogAccess, principal, [
    ...sources.values(),
  ]);
  const playabilityOf = (id: string): Playability => {
    const sourceId = sources.get(id);
    return sourceId
      ? (playable.get(sourceId) as Playability)
      : { playable: false, reason: 'no_audio' as const };
  };
  const origins = ids.filter((id) => placed.get(id)?.side === 'origin' && id !== recordingId);
  const counts = await derivativeCounts(ctx.db, origins, q.include_inferred);
  const name = (id: string) => summaries.get(id)?.name ?? 'unknown';

  // The listener's own recordings linked to a song in the graph (Audio Log). Only the
  // owner's, so another listener's private audio never shows up (NFR-PRV-007).
  const own = await ctx.db
    .selectFrom('audio_log as l')
    .innerJoin('audio_source as s', 's.id', 'l.audio_source_id')
    .select(['l.id', 'l.title', 'l.recorded_at', 'l.linked_recording_id', 'l.audio_source_id'])
    .where('l.author_user_id', '=', principal.userId)
    .where('l.linked_recording_id', 'in', ids)
    .where('s.status', 'not in', ['deleting', 'deleted'])
    .orderBy('l.recorded_at', 'desc')
    .limit(PER_STEP)
    .execute();

  return {
    root: { entity: root, playability: playabilityOf(recordingId) },
    nodes: ids
      .filter((id) => id !== recordingId)
      .map((id) => {
        const at = placed.get(id) as { side: Side; depth: number };
        return {
          entity: summaries.get(id) as EntitySummary,
          side: at.side,
          depth: at.depth,
          playability: playabilityOf(id),
          // For an origin: how many recordings in all come from it (the "+N" hint).
          derivative_count: at.side === 'origin' ? (counts.get(id) ?? 0) : null,
        };
      }),
    edges: kept.map((e) => ({
      relation_id: e.id,
      type: e.relation_type,
      derived_id: e.from_entity_id,
      original_id: e.to_entity_id,
      evidence: evidence(e, name(e.from_entity_id), name(e.to_entity_id)),
    })),
    own_recordings: own.map((l) => ({
      audio_log_id: l.id,
      audio_source_id: l.audio_source_id,
      title: l.title,
      recorded_at: new Date(l.recorded_at).toISOString(),
      linked_recording_id: l.linked_recording_id as string,
    })),
    truncated,
  };
}
