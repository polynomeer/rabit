import type { AppContext } from '../../app/context.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { QueueMode, TimeMachineContext } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { cutoffDate, entitySummaries } from '../catalog/index.js';
import { evaluatePolicy, playabilities, type CatalogAccess } from './policy.js';

/**
 * The account's play queue (ADR-0026). Items keep their order; the ones before the
 * current item were played and stay as history. `user` items were chosen by the
 * listener; `autoplay` items were suggested from the current track, with a reason,
 * and are regenerated every time a track starts.
 */

export type QueueRef = { recording_id: string } | { audio_source_id: string };
export type Placement = 'now' | 'next' | 'end';

/** Track-based suggestions, provided by DIG at the composition root. */
export type RadioProvider = (
  ctx: AppContext,
  principal: Principal,
  seed: string,
  opts: { exclude: ReadonlySet<string>; size: number; includeInferred: boolean; nonce?: string },
) => Promise<{ recording_id: string; reason: unknown }[]>;

/** Time Radio suggestions (ADR-0034), provided by DIG at the composition root. */
export type TimeMachineProvider = (
  ctx: AppContext,
  principal: Principal,
  context: TimeMachineContext,
  opts: { exclude: ReadonlySet<string>; size: number; nonce?: string },
) => Promise<{ recording_id: string; reason: unknown }[]>;

export interface QueueDeps {
  catalogAccess: CatalogAccess;
  resolveRecordingSource: (db: DbOrTx, recordingId: string) => Promise<string | null>;
  radio: RadioProvider;
  timeMachine: TimeMachineProvider;
  /** Releases out after one cutoff date and by another (Time Radio "다음 달로"). */
  releasesBetween: (ctx: AppContext, previous: string, next: string) => Promise<number>;
}

const MAX_ITEMS = 500;
const MAX_HISTORY = 200;
const SUGGESTIONS = 10;
/** Recordings among the newest queue items are not suggested again. */
const RECENT = 50;

type Row = {
  id: string;
  position: number;
  ref_type: 'recording' | 'audio_source';
  ref_id: string;
  origin: 'user' | 'autoplay';
  reason: unknown;
  added_at: Date;
  played_at: Date | null;
};
type Settings = {
  mode: QueueMode;
  radio_context: TimeMachineContext | null;
  autoplay: boolean;
  include_inferred: boolean;
  current_item_id: string | null;
  version: number;
};

async function lockQueue(tx: DbOrTx, userId: string): Promise<Settings> {
  await tx
    .insertInto('play_queue')
    .values({ user_id: userId, current_item_id: null })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  return tx
    .selectFrom('play_queue')
    .select(['mode', 'radio_context', 'autoplay', 'include_inferred', 'current_item_id', 'version'])
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

const loadItems = (db: DbOrTx, userId: string): Promise<Row[]> =>
  db
    .selectFrom('play_queue_item')
    .select(['id', 'position', 'ref_type', 'ref_id', 'origin', 'reason', 'added_at', 'played_at'])
    .where('user_id', '=', userId)
    .orderBy('position')
    .execute();

/**
 * Writes the new order and current item; trims history and length; bumps the
 * version. Rows not in `items` are deleted.
 */
async function save(
  tx: DbOrTx,
  userId: string,
  before: Row[],
  items: (Row | Omit<Row, 'position' | 'added_at'>)[],
  current: string | null,
) {
  let list = items;
  const at = current ? list.findIndex((i) => i.id === current) : -1;
  if (at > MAX_HISTORY) list = list.slice(at - MAX_HISTORY);
  if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
  const keep = new Set(list.map((i) => i.id));
  const gone = before.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (gone.length > 0) await tx.deleteFrom('play_queue_item').where('id', 'in', gone).execute();
  const old = new Map(before.map((r) => [r.id, r]));
  for (const [position, item] of list.entries()) {
    const was = old.get(item.id);
    if (!was) {
      await tx
        .insertInto('play_queue_item')
        .values({
          id: item.id,
          user_id: userId,
          position,
          ref_type: item.ref_type,
          ref_id: item.ref_id,
          origin: item.origin,
          reason: item.reason === null ? null : JSON.stringify(item.reason),
          played_at: item.played_at,
        })
        .execute();
    } else if (
      was.position !== position ||
      was.origin !== item.origin ||
      was.played_at !== item.played_at
    ) {
      await tx
        .updateTable('play_queue_item')
        .set({ position, origin: item.origin, played_at: item.played_at })
        .where('id', '=', item.id)
        .execute();
    }
  }
  await tx
    .updateTable('play_queue')
    .set((eb) => ({
      current_item_id: current && keep.has(current) ? current : null,
      version: eb('version', '+', 1),
      updated_at: new Date(),
    }))
    .where('user_id', '=', userId)
    .execute();
}

const refOf = (r: QueueRef) =>
  'recording_id' in r
    ? { ref_type: 'recording' as const, ref_id: r.recording_id }
    : { ref_type: 'audio_source' as const, ref_id: r.audio_source_id };

/**
 * Replaces the suggestions after the current item with new ones from `seed` (the
 * current track, or the last catalog track before it). Called when a track starts,
 * when items are added, and on request.
 */
async function regenerate(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  settings: Settings,
  items: Row[],
  current: string | null,
  nonce?: string,
): Promise<(Row | Omit<Row, 'position' | 'added_at'>)[]> {
  const at = current ? items.findIndex((i) => i.id === current) : -1;
  // Suggestions not yet reached are dropped; played ones stay as history.
  const kept = items.filter((i, idx) => !(idx > at && i.origin === 'autoplay'));
  const recent = new Set(
    kept
      .slice(-RECENT)
      .filter((i) => i.ref_type === 'recording')
      .map((i) => i.ref_id),
  );
  for (const i of kept.slice(at + 1)) if (i.ref_type === 'recording') recent.add(i.ref_id);
  let picks: { recording_id: string; reason: unknown }[];
  if (settings.mode === 'time_machine' && settings.radio_context) {
    // Time Radio suggests from its cutoff, with or without a current track.
    picks = await deps.timeMachine(ctx, principal, settings.radio_context, {
      exclude: recent,
      size: SUGGESTIONS,
      ...(nonce ? { nonce } : {}),
    });
  } else {
    if (!settings.autoplay || at < 0) return kept;
    const seed = [...kept.slice(0, at + 1)].reverse().find((i) => i.ref_type === 'recording');
    if (!seed) return kept;
    picks = await deps.radio(ctx, principal, seed.ref_id, {
      exclude: recent,
      size: SUGGESTIONS,
      includeInferred: settings.include_inferred,
      ...(nonce ? { nonce } : {}),
    });
  }
  return [
    ...kept,
    ...picks.map((p) => ({
      id: newId('queueItem'),
      ref_type: 'recording' as const,
      ref_id: p.recording_id,
      origin: 'autoplay' as const,
      reason: p.reason,
      played_at: null,
    })),
  ];
}

/** The listener may queue only what they could start: their own audio, catalog tracks. */
async function checkRefs(ctx: AppContext, deps: QueueDeps, principal: Principal, refs: QueueRef[]) {
  for (const r of refs) {
    if ('audio_source_id' in r) {
      const d = await evaluatePolicy(
        ctx.db,
        deps.catalogAccess,
        principal,
        r.audio_source_id,
        'play',
      );
      // Someone else's private audio is "not found", as everywhere (T04).
      if (!d.allow && d.reason === 'not_found') throw errors.notFound();
    } else {
      const exists = await ctx.db
        .selectFrom('recording')
        .select('id')
        .where('id', '=', r.recording_id)
        .executeTakeFirst();
      if (!exists) throw errors.notFound();
    }
  }
}

export async function addToQueue(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  input: { items: QueueRef[]; placement: Placement },
) {
  await checkRefs(ctx, deps, principal, input.items);
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    const before = await loadItems(tx, principal.userId);
    let current = settings.current_item_id;
    const at = current ? before.findIndex((i) => i.id === current) : -1;
    const fresh = input.items.map((r) => ({
      id: newId('queueItem'),
      ...refOf(r),
      origin: 'user' as const,
      reason: null,
      played_at: null as Date | null,
    }));
    let items: (Row | (typeof fresh)[number])[];
    if (input.placement === 'end') {
      // After the listener's other upcoming choices, before the suggestions.
      const firstSuggestion = before.findIndex((i, idx) => idx > at && i.origin === 'autoplay');
      const cut = firstSuggestion < 0 ? before.length : firstSuggestion;
      items = [...before.slice(0, cut), ...fresh, ...before.slice(cut)];
    } else {
      let upcoming = before.slice(at + 1);
      // 자동추천 mode: playing starts over from the new choice; history stays.
      if (input.placement === 'now' && settings.mode === 'radio') upcoming = [];
      items = [...before.slice(0, at + 1), ...fresh, ...upcoming];
    }
    if (input.placement === 'now' && fresh[0]) {
      fresh[0].played_at = new Date();
      current = fresh[0].id;
    } else if (current === null && fresh[0]) {
      // An empty queue starts at the first added item.
      current = fresh[0].id;
      fresh[0].played_at = new Date();
    }
    const withSuggestions = await regenerate(
      ctx,
      deps,
      principal,
      settings,
      items as Row[],
      current,
    );
    await save(tx, principal.userId, before, withSuggestions, current);
  });
  return queueView(ctx, deps, principal);
}

/** A track started (the client moved on or jumped): history and suggestions follow it. */
export async function setCurrent(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  itemId: string,
) {
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    const before = await loadItems(tx, principal.userId);
    const item = before.find((i) => i.id === itemId);
    if (!item) throw errors.notFound();
    const items = before.map((i) => (i.id === itemId ? { ...i, played_at: new Date() } : i));
    const next = await regenerate(ctx, deps, principal, settings, items, itemId);
    await save(tx, principal.userId, before, next, itemId);
  });
  return queueView(ctx, deps, principal);
}

export async function removeItem(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  itemId: string,
) {
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    const before = await loadItems(tx, principal.userId);
    if (!before.some((i) => i.id === itemId)) throw errors.notFound();
    let current = settings.current_item_id;
    if (current === itemId) {
      const at = before.findIndex((i) => i.id === itemId);
      current = before[at + 1]?.id ?? before[at - 1]?.id ?? null;
    }
    await save(
      tx,
      principal.userId,
      before,
      before.filter((i) => i.id !== itemId),
      current,
    );
  });
  return queueView(ctx, deps, principal);
}

/** A suggestion the listener keeps: it becomes their choice and survives regeneration. */
export async function keepItem(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  itemId: string,
) {
  const r = await ctx.db
    .updateTable('play_queue_item')
    .set({ origin: 'user' })
    .where('id', '=', itemId)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw errors.notFound();
  return queueView(ctx, deps, principal);
}

export async function clearQueue(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  scope: 'upcoming' | 'suggestions' | 'history' | 'all',
) {
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    const before = await loadItems(tx, principal.userId);
    const current = settings.current_item_id;
    const at = current ? before.findIndex((i) => i.id === current) : -1;
    const keep = before.filter((i, idx) => {
      if (scope === 'all') return false;
      if (idx === at) return true;
      if (scope === 'history') return idx > at;
      if (scope === 'upcoming') return idx < at;
      return !(idx > at && i.origin === 'autoplay');
    });
    await save(tx, principal.userId, before, keep, scope === 'all' ? null : current);
  });
  return queueView(ctx, deps, principal);
}

export async function updateSettings(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  input: {
    mode?: 'queue' | 'radio' | undefined;
    autoplay?: boolean | undefined;
    include_inferred?: boolean | undefined;
  },
) {
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as {
    mode?: 'queue' | 'radio';
    autoplay?: boolean;
    include_inferred?: boolean;
  };
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    // Choosing queue or radio leaves Time Radio; its context goes with it.
    const leaving = patch.mode !== undefined && settings.mode === 'time_machine';
    await tx
      .updateTable('play_queue')
      .set((eb) => ({
        ...patch,
        ...(patch.mode !== undefined ? { radio_context: null } : {}),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('user_id', '=', principal.userId)
      .execute();
    // Turning autoplay or inferred links on or off changes the suggestions now.
    if (leaving || patch.autoplay !== undefined || patch.include_inferred !== undefined) {
      const before = await loadItems(tx, principal.userId);
      const next = await regenerate(
        ctx,
        deps,
        principal,
        { ...settings, ...patch, ...(patch.mode !== undefined ? { radio_context: null } : {}) },
        before,
        settings.current_item_id,
      );
      await save(tx, principal.userId, before, next, settings.current_item_id);
    }
  });
  return queueView(ctx, deps, principal);
}

/** New suggestions from the current track (the listener asked for others). */
export async function refreshSuggestions(ctx: AppContext, deps: QueueDeps, principal: Principal) {
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    const before = await loadItems(tx, principal.userId);
    const next = await regenerate(
      ctx,
      deps,
      principal,
      settings,
      before,
      settings.current_item_id,
      String(Date.now()),
    );
    await save(tx, principal.userId, before, next, settings.current_item_id);
  });
  return queueView(ctx, deps, principal);
}

export interface QueueItemView {
  item_id: string;
  origin: 'user' | 'autoplay';
  reason: unknown;
  state: 'played' | 'current' | 'upcoming';
  played_at: string | null;
  recording_id: string | null;
  audio_source_id: string | null;
  kind: 'track' | 'private_upload' | 'audio_log';
  title: string | null;
  subtitle: string | null;
  cover_id: string;
  playable: boolean;
  unplayable_reason: string | null;
}

/** The queue with titles, covers and playability, as both clients show it. */
export async function queueView(ctx: AppContext, deps: QueueDeps, principal: Principal) {
  const db = ctx.db;
  const settings = await db
    .selectFrom('play_queue')
    .select(['mode', 'radio_context', 'autoplay', 'include_inferred', 'current_item_id', 'version'])
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  const items = settings ? await loadItems(db, principal.userId) : [];
  const recs = items.filter((i) => i.ref_type === 'recording').map((i) => i.ref_id);
  const srcIds = items.filter((i) => i.ref_type === 'audio_source').map((i) => i.ref_id);
  const [summaries, sources, recordingSources] = await Promise.all([
    recs.length ? summariesOf(db, recs) : new Map<string, Summary>(),
    srcIds.length
      ? db
          .selectFrom('audio_source')
          .select(['id', 'title', 'origin', 'status'])
          .where('id', 'in', srcIds)
          .execute()
      : [],
    Promise.all(
      [...new Set(recs)].map(async (r) => [r, await deps.resolveRecordingSource(db, r)] as const),
    ),
  ]);
  const recSource = new Map(recordingSources);
  const playable = await playabilities(db, deps.catalogAccess, principal, [
    ...srcIds,
    ...[...recSource.values()].filter((s): s is string => s !== null),
  ]);
  const src = new Map(sources.map((s) => [s.id, s]));
  const current = settings?.current_item_id ?? null;
  const at = current ? items.findIndex((i) => i.id === current) : -1;
  return {
    mode: settings?.mode ?? 'queue',
    /** Time Radio only (ADR-0034): the cutoff moment, its zone and date, and the mode. */
    time_machine:
      settings?.mode === 'time_machine' && settings.radio_context
        ? {
            ...settings.radio_context,
            cutoff: cutoffDate(
              new Date(settings.radio_context.cutoff_at),
              settings.radio_context.time_zone,
            ),
          }
        : null,
    autoplay: settings?.autoplay ?? true,
    include_inferred: settings?.include_inferred ?? false,
    current_item_id: current,
    version: settings?.version ?? 0,
    items: items.flatMap((i, idx): QueueItemView[] => {
      const state: QueueItemView['state'] =
        idx < at ? 'played' : idx === at ? 'current' : 'upcoming';
      const base = {
        item_id: i.id,
        origin: i.origin,
        reason: i.reason ?? null,
        state,
        played_at: i.played_at?.toISOString() ?? null,
      };
      if (i.ref_type === 'recording') {
        const s = summaries.get(i.ref_id);
        if (!s) return [];
        const sourceId = recSource.get(i.ref_id) ?? null;
        const p = sourceId ? playable.get(sourceId) : undefined;
        return [
          {
            ...base,
            recording_id: i.ref_id,
            audio_source_id: null,
            kind: 'track' as const,
            title: s.name,
            subtitle: s.subtitle,
            cover_id: s.primary_release_id ?? i.ref_id,
            playable: p?.playable ?? false,
            unplayable_reason: p?.playable ? null : (p?.reason ?? 'no_audio'),
          },
        ];
      }
      const a = src.get(i.ref_id);
      // Deleted (or no longer the listener's) audio leaves the queue silently.
      if (!a || a.status === 'deleted') return [];
      const p = playable.get(i.ref_id);
      return [
        {
          ...base,
          recording_id: null,
          audio_source_id: i.ref_id,
          kind: a.origin === 'audio_log' ? ('audio_log' as const) : ('private_upload' as const),
          title: a.title,
          subtitle: null,
          cover_id: i.ref_id,
          playable: p?.playable ?? false,
          unplayable_reason: p?.playable ? null : (p?.reason ?? 'not_found'),
        },
      ];
    }),
  };
}

type Summary = { name: string; subtitle: string | null; primary_release_id?: string | null };
const summariesOf = (db: Db, ids: string[]): Promise<Map<string, Summary>> =>
  entitySummaries(db, ids);

/**
 * Starts Time Radio (ADR-0034), or changes its cutoff or mode: suggestions are
 * replaced from the new cutoff; the listener's chosen items and history stay. With
 * nothing playing, the first suggestion becomes current so playback can start.
 */
export async function startTimeMachine(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  context: TimeMachineContext,
) {
  await ctx.db.transaction().execute(async (tx) => {
    const settings = await lockQueue(tx, principal.userId);
    await tx
      .updateTable('play_queue')
      .set({ mode: 'time_machine', radio_context: JSON.stringify(context) })
      .where('user_id', '=', principal.userId)
      .execute();
    const before = await loadItems(tx, principal.userId);
    let current = settings.current_item_id;
    const next = await regenerate(
      ctx,
      deps,
      principal,
      { ...settings, mode: 'time_machine', radio_context: context },
      before,
      current,
      String(Date.now()),
    );
    const at = current ? next.findIndex((i) => i.id === current) : -1;
    const upcoming = next.slice(at + 1);
    if (at < 0 || upcoming.every((i) => i.origin === 'autoplay')) {
      // Nothing chosen is waiting: Time Radio plays from its first suggestion.
      const first = upcoming[0];
      if (first) {
        first.played_at = new Date();
        current = first.id;
      }
    }
    await save(tx, principal.userId, before, next, current);
  });
  return queueView(ctx, deps, principal);
}

/** The same calendar day `months` later in the cutoff's zone (clamped to the month's end). */
export function advanceCutoff(context: TimeMachineContext, months: number): TimeMachineContext {
  const at = new Date(context.cutoff_at);
  const from = cutoffDate(at, context.time_zone);
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  target.setUTCDate(Math.min(d, last.getUTCDate()));
  const want = target.toISOString().slice(0, 10);
  // Shift the moment by whole days, then correct for a daylight-saving change.
  const days = Math.round((Date.parse(want) - Date.parse(from)) / 86_400_000);
  let next = new Date(at.getTime() + days * 86_400_000);
  for (const hours of [0, -1, 1, -2, 2]) {
    const tryAt = new Date(next.getTime() + hours * 3_600_000);
    if (cutoffDate(tryAt, context.time_zone) === want) {
      next = tryAt;
      break;
    }
  }
  return { ...context, cutoff_at: next.toISOString() };
}

/** Moves the Time Radio cutoff by whole months; says how many releases came out between. */
export async function advanceTimeMachine(
  ctx: AppContext,
  deps: QueueDeps,
  principal: Principal,
  months: number,
) {
  const row = await ctx.db
    .selectFrom('play_queue')
    .select(['mode', 'radio_context'])
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (row?.mode !== 'time_machine' || !row.radio_context) {
    throw errors.invalidState('Time Radio is not on.');
  }
  const previous = row.radio_context;
  const next = advanceCutoff(previous, months);
  const view = await startTimeMachine(ctx, deps, principal, next);
  const before = cutoffDate(new Date(previous.cutoff_at), previous.time_zone);
  const after = cutoffDate(new Date(next.cutoff_at), next.time_zone);
  const fresh = after > before ? await deps.releasesBetween(ctx, before, after) : 0;
  return { ...view, new_since_previous: fresh };
}

/** Account deletion: the queue goes with the account. */
export async function deleteQueue(db: DbOrTx, userId: string) {
  await db.deleteFrom('play_queue').where('user_id', '=', userId).execute();
}
