import type { DbOrTx } from '../../platform/db/db.js';
import type {
  Basis,
  DigEvidence,
  DigReason,
  EntityType,
  PopularityTier,
  RelationType,
  VerificationState,
} from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import { entitySummaries, type EntitySummary } from '../catalog/index.js';

/**
 * DIG axes (DIG-003). Stored relations are directional; each type has an
 * outgoing and an incoming axis. People/structure axes are derived from credits
 * and release metadata (DIG-006). "Similar Sound" and "Local Scene" need P2 data.
 */
export type DigAxis =
  | 'credits'
  | 'same_producer'
  | 'session_musicians'
  | 'same_label'
  | 'samples'
  | 'sampled_by'
  | 'covers'
  | 'covered_by'
  | 'remixes'
  | 'remix_of'
  | 'influences'
  | 'influenced_by'
  | 'members'
  | 'member_of'
  | 'releases'
  | 'tracks'
  | 'artists';

export type AxisGroup = 'people' | 'history' | 'sound' | 'place';

export const AXIS_GROUP: Record<DigAxis, AxisGroup> = {
  credits: 'people',
  same_producer: 'people',
  session_musicians: 'people',
  artists: 'people',
  members: 'people',
  member_of: 'people',
  same_label: 'history',
  samples: 'history',
  sampled_by: 'history',
  covers: 'history',
  covered_by: 'history',
  remixes: 'history',
  remix_of: 'history',
  influences: 'history',
  influenced_by: 'history',
  releases: 'history',
  tracks: 'history',
};

/** Stored relation axes: [relation type, direction]. Outgoing = from this entity. */
const RELATION_AXES: Partial<Record<DigAxis, [RelationType, 'out' | 'in']>> = {
  samples: ['samples', 'out'],
  sampled_by: ['samples', 'in'],
  covers: ['covers', 'out'],
  covered_by: ['covers', 'in'],
  remix_of: ['remix_of', 'out'],
  remixes: ['remix_of', 'in'],
  influenced_by: ['influenced_by', 'out'],
  influences: ['influenced_by', 'in'],
  member_of: ['member_of', 'out'],
  members: ['member_of', 'in'],
};

const AXES_BY_TYPE: Record<EntityType, DigAxis[]> = {
  recording: [
    'credits',
    'artists',
    'same_producer',
    'session_musicians',
    'releases',
    'same_label',
    'samples',
    'sampled_by',
    'covers',
    'covered_by',
    'remixes',
    'remix_of',
    'influences',
    'influenced_by',
  ],
  person: ['credits', 'members', 'member_of', 'influences', 'influenced_by'],
  artist: ['tracks', 'releases', 'credits', 'members', 'member_of', 'influences', 'influenced_by'],
  release: ['tracks', 'artists', 'credits', 'same_label'],
  label: ['releases'],
};

export interface Connection {
  entityId: string;
  axis: DigAxis;
  relationId: string | null;
  creditId: string | null;
  viaEntityId: string | null;
  evidence: DigEvidence;
}

/**
 * Structural catalog metadata (artists, tracklists, labels) comes from the ingest
 * source; it is shown as declared catalog data, not as independently verified fact.
 */
function catalogEvidence(explanation: string, reason: DigReason): DigEvidence {
  return {
    basis: 'declared',
    verification_state: 'self_declared',
    source: 'catalog',
    confidence: null,
    license_status: null,
    explanation,
    reason,
  };
}

function creditEvidence(
  c: { basis: Basis; verification_state: VerificationState; source: string },
  explanation: string,
  reason: DigReason,
): DigEvidence {
  return { ...c, confidence: null, license_status: null, explanation, reason };
}

/**
 * Reason codes (docs/05-api): `relation.<axis>`, `credit`, `credited_as`,
 * `same_producer`, `same_session_player`, `main_artist`, `on_release`,
 * `recording_by_artist`, `appears_on`, `released_on_label`, `release_by_artist`,
 * `same_label`. Params carry names and raw codes (credit `role`), never sentences.
 */
function reason(code: string, params: Record<string, string | null | undefined> = {}): DigReason {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v) clean[k] = v;
  return { code, params: clean };
}

const ROLE_LABEL: Record<string, string> = {
  composer: 'Composer',
  lyricist: 'Lyricist',
  producer: 'Producer',
  engineer: 'Engineer',
  mixing_engineer: 'Mixing engineer',
  mastering_engineer: 'Mastering engineer',
  performer: 'Performer',
  featured_artist: 'Featured artist',
  arranger: 'Arranger',
};

async function entityType(db: DbOrTx, id: string): Promise<EntityType> {
  const r = await db
    .selectFrom('music_entity')
    .select('entity_type')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw errors.notFound();
  return r.entity_type;
}

function names(map: Map<string, EntitySummary>, id: string): string {
  return map.get(id)?.name ?? 'unknown';
}

/**
 * Every connection from `entityId` along `axis`, each with its reason
 * (DIG-004) and provenance/verification (DIG-018). Bounded to 500 candidates.
 */
export async function connectionsFor(
  db: DbOrTx,
  entityId: string,
  axis: DigAxis,
): Promise<Connection[]> {
  const type = await entityType(db, entityId);
  if (!AXES_BY_TYPE[type].includes(axis)) return [];
  const LIMIT = 500;
  const out: Connection[] = [];

  const rel = RELATION_AXES[axis];
  if (rel) {
    const [relType, dir] = rel;
    const rows = await db
      .selectFrom('music_relation')
      .selectAll()
      .where('relation_type', '=', relType)
      .where(dir === 'out' ? 'from_entity_id' : 'to_entity_id', '=', entityId)
      .where((eb) =>
        eb.or([
          eb('valid_to', 'is', null),
          eb('valid_to', '>=', new Date().toISOString().slice(0, 10)),
        ]),
      )
      .limit(LIMIT)
      .execute();
    const other = (r: (typeof rows)[number]) => (dir === 'out' ? r.to_entity_id : r.from_entity_id);
    const n = await entitySummaries(db, [entityId, ...rows.map(other)]);
    const phrase: Record<DigAxis, string> = {
      samples: 'samples',
      sampled_by: 'is sampled by',
      covers: 'is a cover of',
      covered_by: 'is covered by',
      remix_of: 'is a remix of',
      remixes: 'is remixed by',
      influenced_by: 'is influenced by',
      influences: 'influences',
      member_of: 'is a member of',
      members: 'has member',
    } as Record<DigAxis, string>;
    for (const r of rows) {
      out.push({
        entityId: other(r),
        axis,
        relationId: r.id,
        creditId: null,
        viaEntityId: null,
        evidence: {
          basis: r.basis,
          verification_state: r.verification_state,
          source: r.source,
          confidence: r.confidence,
          // The relation fact and its license are separate (DIG-018, rights-model §2.4).
          license_status: r.license_status,
          explanation: `${names(n, entityId)} ${phrase[axis]} ${names(n, other(r))}`,
          reason: reason(`relation.${axis}`, {
            subject: names(n, entityId),
            object: names(n, other(r)),
          }),
        },
      });
    }
    return out;
  }

  switch (axis) {
    case 'credits': {
      if (type === 'recording' || type === 'release') {
        const rows = await db
          .selectFrom('credit')
          .selectAll()
          .where('subject_entity_id', '=', entityId)
          .limit(LIMIT)
          .execute();
        const n = await entitySummaries(
          db,
          rows.map((r) => r.contributor_entity_id),
        );
        for (const c of rows) {
          const role = ROLE_LABEL[c.role] ?? c.role;
          out.push({
            entityId: c.contributor_entity_id,
            axis,
            relationId: null,
            creditId: c.id,
            viaEntityId: null,
            evidence: creditEvidence(
              c,
              `${role}${c.instrument ? ` (${c.instrument})` : ''}: ${names(n, c.contributor_entity_id)}`,
              reason('credit', {
                role: c.role,
                instrument: c.instrument,
                name: names(n, c.contributor_entity_id),
              }),
            ),
          });
        }
      } else {
        const rows = await db
          .selectFrom('credit')
          .selectAll()
          .where('contributor_entity_id', '=', entityId)
          .limit(LIMIT)
          .execute();
        const n = await entitySummaries(db, [entityId]);
        for (const c of rows) {
          out.push({
            entityId: c.subject_entity_id,
            axis,
            relationId: null,
            creditId: c.id,
            viaEntityId: null,
            evidence: creditEvidence(
              c,
              `${names(n, entityId)} is credited as ${(ROLE_LABEL[c.role] ?? c.role).toLowerCase()}`,
              reason('credited_as', { role: c.role, name: names(n, entityId) }),
            ),
          });
        }
      }
      return out;
    }
    case 'same_producer':
    case 'session_musicians': {
      // Other recordings that share a producer (or a performer) with this one.
      const roles = axis === 'same_producer' ? (['producer'] as const) : (['performer'] as const);
      const mine = await db
        .selectFrom('credit')
        .selectAll()
        .where('subject_entity_id', '=', entityId)
        .where('role', 'in', roles)
        .execute();
      if (mine.length === 0) return [];
      const rows = await db
        .selectFrom('credit as c')
        .innerJoin('music_entity as e', 'e.id', 'c.subject_entity_id')
        .selectAll('c')
        .where(
          'c.contributor_entity_id',
          'in',
          mine.map((m) => m.contributor_entity_id),
        )
        .where('c.role', 'in', roles)
        .where('c.subject_entity_id', '!=', entityId)
        .where('e.entity_type', '=', 'recording')
        .limit(LIMIT)
        .execute();
      const n = await entitySummaries(
        db,
        rows.map((r) => r.contributor_entity_id),
      );
      for (const c of rows) {
        const shared = mine.find((m) => m.contributor_entity_id === c.contributor_entity_id);
        // The weaker of the two credits bounds the strength of the connection.
        const weaker = shared && rank(shared.basis) > rank(c.basis) ? shared : c;
        const label =
          axis === 'same_producer' ? 'Same producer' : `Same ${c.instrument ?? 'session'} player`;
        out.push({
          entityId: c.subject_entity_id,
          axis,
          relationId: null,
          creditId: c.id,
          viaEntityId: c.contributor_entity_id,
          evidence: creditEvidence(
            weaker,
            `${label}: ${names(n, c.contributor_entity_id)}`,
            axis === 'same_producer'
              ? reason('same_producer', { name: names(n, c.contributor_entity_id) })
              : reason('same_session_player', {
                  name: names(n, c.contributor_entity_id),
                  instrument: c.instrument,
                }),
          ),
        });
      }
      return dedupe(out);
    }
    case 'artists': {
      const rows =
        type === 'recording'
          ? await db
              .selectFrom('recording_artist')
              .select(['artist_id'])
              .where('recording_id', '=', entityId)
              .orderBy('ord')
              .execute()
          : await db
              .selectFrom('release_artist')
              .select(['artist_id'])
              .where('release_id', '=', entityId)
              .orderBy('ord')
              .execute();
      return rows.map((r) => ({
        entityId: r.artist_id,
        axis,
        relationId: null,
        creditId: null,
        viaEntityId: null,
        evidence: catalogEvidence('Main artist', reason('main_artist')),
      }));
    }
    case 'tracks': {
      const rows =
        type === 'release'
          ? await db
              .selectFrom('release_track')
              .select(['recording_id', 'position'])
              .where('release_id', '=', entityId)
              .orderBy('disc_no')
              .orderBy('position')
              .execute()
          : await db
              .selectFrom('recording_artist')
              .select(['recording_id'])
              .where('artist_id', '=', entityId)
              .limit(LIMIT)
              .execute();
      return rows.map((r) => ({
        entityId: r.recording_id,
        axis,
        relationId: null,
        creditId: null,
        viaEntityId: null,
        evidence:
          type === 'release'
            ? catalogEvidence('On this release', reason('on_release'))
            : catalogEvidence('Recording by this artist', reason('recording_by_artist')),
      }));
    }
    case 'releases': {
      const rows =
        type === 'recording'
          ? await db
              .selectFrom('release_track')
              .select('release_id')
              .where('recording_id', '=', entityId)
              .distinct()
              .execute()
          : type === 'label'
            ? await db
                .selectFrom('release')
                .select('id as release_id')
                .where('label_id', '=', entityId)
                .limit(LIMIT)
                .execute()
            : await db
                .selectFrom('release_artist')
                .select('release_id')
                .where('artist_id', '=', entityId)
                .limit(LIMIT)
                .execute();
      const why =
        type === 'recording'
          ? catalogEvidence('Appears on', reason('appears_on'))
          : type === 'label'
            ? catalogEvidence('Released on this label', reason('released_on_label'))
            : catalogEvidence('Release by this artist', reason('release_by_artist'));
      return rows.map((r) => ({
        entityId: r.release_id,
        axis,
        relationId: null,
        creditId: null,
        viaEntityId: null,
        evidence: why,
      }));
    }
    case 'same_label': {
      const labels =
        type === 'release'
          ? await db
              .selectFrom('release')
              .select('label_id')
              .where('id', '=', entityId)
              .where('label_id', 'is not', null)
              .execute()
          : await db
              .selectFrom('release_track as t')
              .innerJoin('release as r', 'r.id', 't.release_id')
              .select('r.label_id')
              .where('t.recording_id', '=', entityId)
              .where('r.label_id', 'is not', null)
              .distinct()
              .execute();
      const labelIds = labels.map((l) => l.label_id).filter((x): x is string => x !== null);
      if (labelIds.length === 0) return [];
      const n = await entitySummaries(db, labelIds);
      if (type === 'release') {
        const rows = await db
          .selectFrom('release')
          .select(['id', 'label_id'])
          .where('label_id', 'in', labelIds)
          .where('id', '!=', entityId)
          .limit(LIMIT)
          .execute();
        return rows.map((r) => ({
          entityId: r.id,
          axis,
          relationId: null,
          creditId: null,
          viaEntityId: r.label_id,
          evidence: catalogEvidence(
            `Same label: ${names(n, r.label_id ?? '')}`,
            reason('same_label', { name: names(n, r.label_id ?? '') }),
          ),
        }));
      }
      const rows = await db
        .selectFrom('release_track as t')
        .innerJoin('release as r', 'r.id', 't.release_id')
        .select(['t.recording_id', 'r.label_id'])
        .where('r.label_id', 'in', labelIds)
        .where('t.recording_id', '!=', entityId)
        .distinct()
        .limit(LIMIT)
        .execute();
      return rows.map((r) => ({
        entityId: r.recording_id,
        axis,
        relationId: null,
        creditId: null,
        viaEntityId: r.label_id,
        evidence: catalogEvidence(
          `Same label: ${names(n, r.label_id ?? '')}`,
          reason('same_label', { name: names(n, r.label_id ?? '') }),
        ),
      }));
    }
    default:
      return out;
  }
}

function rank(b: Basis): number {
  return b === 'verified_fact' ? 0 : b === 'declared' ? 1 : 2;
}

function dedupe(list: Connection[]): Connection[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.entityId}:${c.viaEntityId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Available axes for an entity with counts (DIG-003: the user picks the axis). */
export async function axesFor(db: DbOrTx, entityId: string) {
  const type = await entityType(db, entityId);
  const axes = [];
  for (const axis of AXES_BY_TYPE[type]) {
    const count = (await connectionsFor(db, entityId, axis)).length;
    if (count > 0) axes.push({ axis, group: AXIS_GROUP[axis], count });
  }
  return axes;
}

export type PopularityFilter = 'any' | 'below_top_50' | 'deep_cuts' | 'obscure';

/** Relative-popularity ceilings (dig spec §4). Unknown popularity always passes. */
export const POPULARITY_CEILING: Record<PopularityFilter, number> = {
  any: Infinity,
  below_top_50: 0.5,
  deep_cuts: 0.25,
  obscure: 0.1,
};

export async function popularityOf(
  db: DbOrTx,
  ids: string[],
): Promise<Map<string, { percentile: number | null; tier: PopularityTier }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('recording_popularity')
    .select(['recording_id', 'percentile', 'tier'])
    .where('recording_id', 'in', ids)
    .execute();
  return new Map(rows.map((r) => [r.recording_id, { percentile: r.percentile, tier: r.tier }]));
}

/**
 * Ordering without popularity bias (DIG-019): stronger evidence first, then
 * alphabetical. Novelty/diversity ranking is P1.
 */
export function orderConnections(list: Connection[], sortNames: Map<string, string>): Connection[] {
  return [...list].sort(
    (a, b) =>
      rank(a.evidence.basis) - rank(b.evidence.basis) ||
      (sortNames.get(a.entityId) ?? '').localeCompare(sortNames.get(b.entityId) ?? '') ||
      a.entityId.localeCompare(b.entityId),
  );
}
