import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { DigEvidence, DigSessionTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { getOwnSource } from '../audio/index.js';
import { entitySummaries, recordingSource, type EntitySummary } from '../catalog/index.js';
import { createPlaylist } from '../library/index.js';
import { playability, type CatalogAccess } from '../playback/index.js';
import {
  axesFor,
  connectionsFor,
  orderConnections,
  popularityOf,
  POPULARITY_CEILING,
  type DigAxis,
  type PopularityFilter,
} from './connections.js';

/** Bounded so trails and trail playlists stay cheap to render (review #6). */
export const MAX_TRAIL_NODES = 500;

export interface DigDeps {
  catalogAccess: CatalogAccess;
  /** Entities excluded from DIG candidates by Music Integrity (DIG-020). */
  excludedEntities(db: DbOrTx, ids: string[]): Promise<Set<string>>;
}

export async function getAxes(db: DbOrTx, entityId: string) {
  const entity = (await entitySummaries(db, [entityId])).get(entityId);
  if (!entity) throw errors.notFound();
  return { entity, axes: await axesFor(db, entityId) };
}

export async function explore(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  entityId: string,
  q: {
    axis: DigAxis;
    popularity: PopularityFilter;
    include_inferred: boolean;
    limit: number;
    cursor?: string | undefined;
  },
) {
  await getAxes(ctx.db, entityId); // 404 for unknown entities
  let list = await connectionsFor(ctx.db, entityId, q.axis);
  if (!q.include_inferred) list = list.filter((c) => c.evidence.basis !== 'ml_inferred');
  const excluded = await deps.excludedEntities(
    ctx.db,
    list.map((c) => c.entityId),
  );
  list = list.filter((c) => !excluded.has(c.entityId));

  const ids = list.map((c) => c.entityId);
  const [summaries, pop] = await Promise.all([
    entitySummaries(ctx.db, ids),
    popularityOf(ctx.db, ids),
  ]);
  // Deep Cut (DIG-007): filter by relative popularity; unknown never counts as popular.
  const ceiling = POPULARITY_CEILING[q.popularity];
  list = list.filter((c) => {
    if (summaries.get(c.entityId)?.entity_type !== 'recording') return true;
    const p = pop.get(c.entityId)?.percentile ?? null;
    return p === null || p < ceiling;
  });
  const sortNames = new Map(
    [...summaries.values()].map((s) => [s.entity_id, s.name.toLowerCase()]),
  );
  list = orderConnections(list, sortNames);

  const scope = {
    userId: principal.userId,
    query: `dig:${entityId}:${q.axis}:${q.popularity}:${q.include_inferred}`,
  };
  const offset = Number((ctx.cursors.decode(scope, q.cursor) ?? [0])[0]);
  const page = list.slice(offset, offset + q.limit);
  const viaIds = page.map((c) => c.viaEntityId).filter((x): x is string => x !== null);
  const vias = await entitySummaries(ctx.db, viaIds);
  return {
    items: await Promise.all(
      page.map(async (c) => {
        const entity = summaries.get(c.entityId) as EntitySummary;
        return {
          entity,
          axis: c.axis,
          via: {
            relation_id: c.relationId,
            credit_id: c.creditId,
            via_entity: c.viaEntityId ? (vias.get(c.viaEntityId) ?? null) : null,
          },
          evidence: c.evidence,
          popularity_tier: pop.get(c.entityId)?.tier ?? 'unknown',
          playability:
            entity.entity_type === 'recording'
              ? await playability(
                  ctx.db,
                  deps.catalogAccess,
                  principal,
                  await recordingSource(ctx.db, c.entityId),
                )
              : null,
        };
      }),
    ),
    next_cursor:
      offset + q.limit < list.length ? ctx.cursors.encode(scope, [offset + q.limit]) : null,
  };
}

type SessionRow = Selectable<DigSessionTable>;

async function ownSession(
  db: DbOrTx,
  principal: Principal,
  id: string,
  lock = false,
): Promise<SessionRow> {
  let q = db
    .selectFrom('dig_session')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', principal.userId);
  if (lock) q = q.forUpdate();
  const s = await q.executeTakeFirst();
  if (!s) throw errors.notFound();
  return s;
}

export async function sessionView(db: DbOrTx, s: SessionRow) {
  const nodes = await db
    .selectFrom('dig_trail_node')
    .selectAll()
    .where('session_id', '=', s.id)
    .orderBy('seq')
    .execute();
  const summaries = await entitySummaries(
    db,
    nodes.map((n) => n.entity_id),
  );
  let emptyState: { reason: 'no_catalog_link' | 'no_connections'; message: string } | null = null;
  if (!s.start_entity_id) {
    emptyState = {
      reason: 'no_catalog_link',
      message:
        'This audio is not linked to anything in the catalog yet. Link it to a recording to start digging.',
    };
  } else if (nodes.length === 1 && (await axesFor(db, s.start_entity_id)).length === 0) {
    emptyState = { reason: 'no_connections', message: 'No connections are known for this yet.' };
  }
  const recordingIds = nodes
    .filter((n) => summaries.get(n.entity_id)?.entity_type === 'recording')
    .map((n) => n.entity_id);
  const artists = recordingIds.length
    ? await db
        .selectFrom('recording_artist')
        .select('artist_id')
        .where('recording_id', 'in', recordingIds)
        .execute()
    : [];
  const artistIds = new Set([
    ...artists.map((a) => a.artist_id),
    ...nodes
      .filter((n) => summaries.get(n.entity_id)?.entity_type === 'artist')
      .map((n) => n.entity_id),
  ]);
  return {
    dig_session_id: s.id,
    state: s.state,
    title: s.title,
    saved: s.saved,
    visibility: s.visibility,
    current_seq: s.current_seq,
    empty_state: emptyState,
    trail: nodes.map((n) => ({
      seq: n.seq,
      parent_seq: n.parent_seq,
      entity: summaries.get(n.entity_id) ?? {
        entity_id: n.entity_id,
        entity_type: 'recording',
        name: 'unknown',
        subtitle: null,
      },
      via_axis: n.via_axis,
      evidence: n.via_evidence,
      played: n.played,
      saved: n.saved,
      created_at: n.created_at.toISOString(),
    })),
    started_at: s.started_at.toISOString(),
    ended_at: s.ended_at?.toISOString() ?? null,
    summary: {
      nodes: nodes.length,
      distinct_artists: artistIds.size,
      axes_used: [...new Set(nodes.map((n) => n.via_axis).filter((a): a is string => a !== null))],
      played: nodes.filter((n) => n.played).length,
      saved: nodes.filter((n) => n.saved).length,
    },
  };
}

/**
 * Starts a session from a catalog entity, or from the caller's own audio. Own
 * audio is linked to the catalog only through an explicit recording link
 * (Audio Log `linked_recording_id`); otherwise the session opens in an empty
 * state (DIG-025). Another user's audio is a 404.
 */
export async function startSession(
  db: Db,
  principal: Principal,
  input: { entity_id?: string | undefined; audio_source_id?: string | undefined },
) {
  let entityId: string | null = null;
  let sourceId: string | null = null;
  if (input.entity_id) {
    const e = await db
      .selectFrom('music_entity')
      .select('id')
      .where('id', '=', input.entity_id)
      .executeTakeFirst();
    if (!e) throw errors.notFound();
    entityId = e.id;
  } else if (input.audio_source_id) {
    const src = await getOwnSource(db, principal, input.audio_source_id);
    if (src.status === 'deleting') throw errors.notFound();
    sourceId = src.id;
    const log = await db
      .selectFrom('audio_log')
      .select('linked_recording_id')
      .where('audio_source_id', '=', src.id)
      .executeTakeFirst();
    entityId = log?.linked_recording_id ?? src.recording_id ?? null;
  } else {
    throw errors.validation({ body: 'entity_id or audio_source_id is required' });
  }
  const s = await db.transaction().execute(async (tx) => {
    const row = await tx
      .insertInto('dig_session')
      .values({
        id: newId('digSession'),
        user_id: principal.userId,
        start_entity_id: entityId,
        start_audio_source_id: sourceId,
        state: 'active',
        title: null,
        ended_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (entityId) {
      await tx
        .insertInto('dig_trail_node')
        .values({
          id: newId('digNode'),
          session_id: row.id,
          seq: 0,
          parent_seq: null,
          entity_id: entityId,
          via_axis: null,
          via_relation_id: null,
          via_credit_id: null,
          via_evidence: null,
        })
        .execute();
    }
    return row;
  });
  return sessionView(db, s);
}

export async function getSession(db: DbOrTx, principal: Principal, id: string) {
  return sessionView(db, await ownSession(db, principal, id));
}

/**
 * Records a step. The server re-derives the parent's connections and accepts the
 * step only if the claimed edge exists — clients cannot fabricate relations (T29).
 */
export async function addStep(
  db: Db,
  deps: DigDeps,
  principal: Principal,
  id: string,
  step: {
    from_seq?: number | undefined;
    entity_id: string;
    axis: DigAxis;
    relation_id?: string | undefined;
    credit_id?: string | undefined;
  },
) {
  return db.transaction().execute(async (tx) => {
    const s = await ownSession(tx, principal, id, true);
    if (s.state !== 'active') throw errors.invalidState('This dig session has ended.');
    const fromSeq = step.from_seq ?? s.current_seq;
    const parent = await tx
      .selectFrom('dig_trail_node')
      .select(['entity_id'])
      .where('session_id', '=', s.id)
      .where('seq', '=', fromSeq)
      .executeTakeFirst();
    if (!parent)
      throw errors.unprocessable('INVALID_RELATION_STEP', 'There is no node to dig from.');
    const match = (await connectionsFor(tx, parent.entity_id, step.axis)).find(
      (c) =>
        c.entityId === step.entity_id &&
        (step.relation_id === undefined || c.relationId === step.relation_id) &&
        (step.credit_id === undefined || c.creditId === step.credit_id),
    );
    // Entities excluded by a reviewed integrity decision are not reachable (DIG-020, review #9).
    if (!match || (await deps.excludedEntities(tx, [step.entity_id])).has(step.entity_id)) {
      throw errors.unprocessable(
        'INVALID_RELATION_STEP',
        'That connection does not exist from this point.',
      );
    }
    const last = await tx
      .selectFrom('dig_trail_node')
      .select((eb) => eb.fn.max('seq').as('m'))
      .where('session_id', '=', s.id)
      .executeTakeFirstOrThrow();
    // A parent node exists (checked above), so the session has at least one node.
    const seq = last.m + 1;
    if (seq >= MAX_TRAIL_NODES) {
      throw errors.invalidState(
        `A dig trail can hold at most ${MAX_TRAIL_NODES} steps. Start a new session.`,
      );
    }
    await tx
      .insertInto('dig_trail_node')
      .values({
        id: newId('digNode'),
        session_id: s.id,
        seq,
        parent_seq: fromSeq,
        entity_id: step.entity_id,
        via_axis: step.axis,
        via_relation_id: match.relationId,
        via_credit_id: match.creditId,
        via_evidence: JSON.stringify(match.evidence satisfies DigEvidence),
      })
      .execute();
    const updated = await tx
      .updateTable('dig_session')
      .set({ current_seq: seq })
      .where('id', '=', s.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return sessionView(tx, updated);
  });
}

/** Return to an earlier node (DIG-005). Nothing is deleted; the cursor moves. */
export async function moveCursor(db: Db, principal: Principal, id: string, seq: number) {
  const s = await ownSession(db, principal, id);
  const node = await db
    .selectFrom('dig_trail_node')
    .select('seq')
    .where('session_id', '=', s.id)
    .where('seq', '=', seq)
    .executeTakeFirst();
  if (!node)
    throw errors.unprocessable('INVALID_RELATION_STEP', 'There is no such node in this trail.');
  const updated = await db
    .updateTable('dig_session')
    .set({ current_seq: seq })
    .where('id', '=', s.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return sessionView(db, updated);
}

export async function recordAction(
  db: Db,
  principal: Principal,
  id: string,
  seq: number,
  action: 'played' | 'saved',
) {
  const s = await ownSession(db, principal, id);
  const res = await db
    .updateTable('dig_trail_node')
    .set(action === 'played' ? { played: true } : { saved: true })
    .where('session_id', '=', s.id)
    .where('seq', '=', seq)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) throw errors.notFound();
  return getSession(db, principal, id);
}

export async function updateSession(
  db: Db,
  principal: Principal,
  id: string,
  patch: { title?: string | null | undefined; saved?: boolean | undefined },
) {
  await ownSession(db, principal, id);
  const updated = await db
    .updateTable('dig_session')
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.saved !== undefined ? { saved: patch.saved } : {}),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return sessionView(db, updated);
}

export async function endSession(db: Db, principal: Principal, id: string) {
  const s = await ownSession(db, principal, id);
  const updated =
    s.state === 'ended'
      ? s
      : await db
          .updateTable('dig_session')
          .set({ state: 'ended', ended_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
  return sessionView(db, updated);
}

/** Trail → playlist (DIG-022): recordings in trail order, each once. */
export async function trailToPlaylist(
  db: Db,
  principal: Principal,
  id: string,
  title: string | undefined,
) {
  const s = await ownSession(db, principal, id);
  const nodes = await db
    .selectFrom('dig_trail_node as n')
    .innerJoin('music_entity as e', 'e.id', 'n.entity_id')
    .select(['n.entity_id', 'e.display_name'])
    .where('n.session_id', '=', s.id)
    .where('e.entity_type', '=', 'recording')
    .orderBy('n.seq')
    .execute();
  const unique = [...new Map(nodes.map((n) => [n.entity_id, n])).values()];
  const first = (await entitySummaries(db, s.start_entity_id ? [s.start_entity_id] : [])).get(
    s.start_entity_id ?? '',
  );
  return db.transaction().execute((tx) =>
    createPlaylist(
      tx,
      principal,
      { title: title ?? s.title ?? `Dig from ${first?.name ?? 'my trail'}`.slice(0, 200) },
      unique.map((n) => ({ ref_type: 'recording' as const, ref_id: n.entity_id })),
    ),
  );
}

export async function listSessions(
  ctx: AppContext,
  principal: Principal,
  q: { saved?: boolean | undefined; limit: number; cursor?: string | undefined },
) {
  const scope = { userId: principal.userId, query: `dig-sessions:${String(q.saved)}` };
  const pos = ctx.cursors.decode(scope, q.cursor);
  let query = ctx.db
    .selectFrom('dig_session as s')
    .selectAll('s')
    .select((eb) =>
      eb
        .selectFrom('dig_trail_node as n')
        .select(eb.fn.countAll<number>().as('c'))
        .whereRef('n.session_id', '=', 's.id')
        .as('nodes'),
    )
    .where('s.user_id', '=', principal.userId);
  if (q.saved !== undefined) query = query.where('s.saved', '=', q.saved);
  if (pos) {
    const [at, sid] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('s.started_at', '<', new Date(at)),
        eb.and([eb('s.started_at', '=', new Date(at)), eb('s.id', '<', sid)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('s.started_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const starts = await entitySummaries(
    ctx.db,
    page.map((r) => r.start_entity_id).filter((x): x is string => x !== null),
  );
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      dig_session_id: r.id,
      title: r.title,
      saved: r.saved,
      state: r.state,
      start_entity: r.start_entity_id ? (starts.get(r.start_entity_id) ?? null) : null,
      nodes: r.nodes ?? 0,
      started_at: r.started_at.toISOString(),
    })),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode(scope, [last.started_at.toISOString(), last.id])
        : null,
  };
}
