import { sql, type Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { BlindDigItemTable } from '../../platform/db/schema.js';
import { AppError, errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { entitySummaries, recordingSources } from '../catalog/index.js';
import { addLibraryItem } from '../library/index.js';
import { playabilities } from '../playback/index.js';
import {
  axesFor,
  connectionsFor,
  popularityOf,
  POPULARITY_CEILING,
  type PopularityFilter,
} from './connections.js';
import type { DigDeps } from './service.js';

/**
 * Blind Digging (DIG-010): a round of up to ROUND_SIZE recordings the user can
 * play, presented without artist, release, year or popularity. Each is revealed
 * after Keep (saved to the library) or Pass. Blindness is a choice the user makes
 * for their own discovery, not a secret: the round carries recording ids so the
 * normal playback path (rights and entitlement checks) plays them, and nothing
 * else about a recording is sent before its decision.
 */
export const ROUND_SIZE = 10;
const POOL = 300;

type Item = Selectable<BlindDigItemTable>;

/** Playable, not excluded, within the popularity ceiling; shuffled. */
async function candidates(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  startEntityId: string | null,
  popularity: PopularityFilter,
): Promise<string[]> {
  let ids: string[];
  if (startEntityId) {
    const axes = await axesFor(ctx.db, startEntityId);
    const found = new Set<string>();
    for (const a of axes) {
      for (const c of await connectionsFor(ctx.db, startEntityId, a.axis)) found.add(c.entityId);
    }
    found.delete(startEntityId);
    ids = [...found];
  } else {
    const rows = await ctx.db
      .selectFrom('recording')
      .select('id')
      .where('catalog_audio_source_id', 'is not', null)
      .orderBy(sql`random()`)
      .limit(POOL)
      .execute();
    ids = rows.map((r) => r.id);
  }
  const recordings = await ctx.db
    .selectFrom('music_entity')
    .select('id')
    .where('id', 'in', ids.length ? ids : [''])
    .where('entity_type', '=', 'recording')
    .execute();
  ids = recordings.map((r) => r.id);

  const excluded = await deps.excludedEntities(ctx.db, ids);
  ids = ids.filter((id) => !excluded.has(id));
  const ceiling = POPULARITY_CEILING[popularity];
  const pop = await popularityOf(ctx.db, ids);
  ids = ids.filter((id) => (pop.get(id)?.percentile ?? 0) <= ceiling);

  const sources = await recordingSources(ctx.db, ids);
  const playable = await playabilities(ctx.db, deps.catalogAccess, principal, [
    ...sources.values(),
  ]);
  ids = ids.filter((id) => {
    const src = sources.get(id);
    return src !== undefined && playable.get(src)?.playable === true;
  });
  // Random order, so neither popularity nor catalog order leaks through position.
  return ids
    .map((id) => ({ id, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, ROUND_SIZE)
    .map((x) => x.id);
}

/** What a decided item reveals; undecided items reveal nothing. */
async function reveals(db: DbOrTx, items: Item[]) {
  const decided = items.filter((i) => i.decision !== null).map((i) => i.recording_id);
  if (decided.length === 0) return new Map<string, unknown>();
  const [summaries, pop, releases] = await Promise.all([
    entitySummaries(db, decided),
    popularityOf(db, decided),
    db
      .selectFrom('release_track as t')
      .innerJoin('release as r', 'r.id', 't.release_id')
      .select(['t.recording_id', 'r.id', 'r.title', 'r.release_date'])
      .where('t.recording_id', 'in', decided)
      .orderBy('r.release_date', (ob) => ob.asc().nullsLast())
      .execute(),
  ]);
  const out = new Map<string, unknown>();
  for (const id of decided) {
    const rel = releases.find((r) => r.recording_id === id);
    out.set(id, {
      recording: summaries.get(id) ?? null,
      release: rel
        ? { release_id: rel.id, title: rel.title, release_date: rel.release_date }
        : null,
      popularity_tier: pop.get(id)?.tier ?? 'unknown',
    });
  }
  return out;
}

async function roundView(db: DbOrTx, round: { id: string; popularity: string; created_at: Date }) {
  const items = await db
    .selectFrom('blind_dig_item')
    .selectAll()
    .where('blind_dig_id', '=', round.id)
    .orderBy('position')
    .execute();
  const revealed = await reveals(db, items);
  return {
    blind_dig_id: round.id,
    popularity: round.popularity,
    created_at: round.created_at.toISOString(),
    items: items.map((i) => ({
      item_id: i.id,
      position: i.position,
      recording_id: i.recording_id,
      decision: i.decision,
      reveal: i.decision ? (revealed.get(i.recording_id) ?? null) : null,
    })),
  };
}

export async function startBlindDig(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  input: { start_entity_id?: string | undefined; popularity: PopularityFilter },
) {
  const start = input.start_entity_id ?? null;
  if (start && !(await entitySummaries(ctx.db, [start])).has(start)) throw errors.notFound();
  const picked = await candidates(ctx, deps, principal, start, input.popularity);
  const round = await ctx.db.transaction().execute(async (tx) => {
    const r = await tx
      .insertInto('blind_dig')
      .values({
        id: newId('blindDig'),
        user_id: principal.userId,
        start_entity_id: start,
        popularity: input.popularity,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (picked.length > 0) {
      await tx
        .insertInto('blind_dig_item')
        .values(
          picked.map((recordingId, position) => ({
            id: newId('blindDigItem'),
            blind_dig_id: r.id,
            recording_id: recordingId,
            position,
            decision: null,
            decided_at: null,
          })),
        )
        .execute();
    }
    return r;
  });
  return roundView(ctx.db, round);
}

async function ownRound(db: DbOrTx, principal: Principal, id: string) {
  const round = await db
    .selectFrom('blind_dig')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (!round) throw errors.notFound();
  return round;
}

export async function getBlindDig(db: DbOrTx, principal: Principal, id: string) {
  return roundView(db, await ownRound(db, principal, id));
}

/** Keep saves the recording to the library; a decision is final. */
export async function decideBlindItem(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  roundId: string,
  itemId: string,
  decision: 'keep' | 'pass',
) {
  const round = await ownRound(ctx.db, principal, roundId);
  const res = await ctx.db
    .updateTable('blind_dig_item')
    .set({ decision, decided_at: new Date() })
    .where('id', '=', itemId)
    .where('blind_dig_id', '=', round.id)
    .where('decision', 'is', null)
    .returningAll()
    .executeTakeFirst();
  if (!res) {
    const exists = await ctx.db
      .selectFrom('blind_dig_item')
      .select('decision')
      .where('id', '=', itemId)
      .where('blind_dig_id', '=', round.id)
      .executeTakeFirst();
    if (!exists) throw errors.notFound();
    if (exists.decision !== decision) throw errors.invalidState('This item was already decided.');
  } else if (decision === 'keep') {
    try {
      await addLibraryItem(ctx, deps.catalogAccess, principal, {
        ref_type: 'recording',
        ref_id: res.recording_id,
      });
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'ALREADY_EXISTS')) throw err;
    }
  }
  return roundView(ctx.db, round);
}
