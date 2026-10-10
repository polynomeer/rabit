import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { PlaylistTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import type { CatalogAccess } from '../playback/index.js';
import { assertRefAccessible } from './library.js';
import { resolveRefs, type ResolvedRef } from './resolve.js';

export const MAX_PLAYLIST_ITEMS = 10_000;

type PlaylistRow = Selectable<PlaylistTable>;
type ItemRef = { ref_type: 'audio_source' | 'recording'; ref_id: string };

/** Items per page of a playlist read; the playlist itself carries the first page (review #6). */
export const PLAYLIST_ITEMS_PAGE = 100;

const itemsScope = (principal: Principal, playlistId: string) => ({
  userId: principal.userId,
  query: `playlist-items:${playlistId}`,
});

/** Reads a playlist and its items from one snapshot, so a page always matches its version. */
function readSnapshot<T>(db: Db, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute(fn);
}

/**
 * One page of items from `fromRank`. Availability is re-evaluated on every read,
 * because playback rights and visibility may have changed, in one batch per page.
 * The cursor is bound to the playlist version; ranks shift on every edit.
 */
async function itemsPage(
  ctx: AppContext,
  tx: DbOrTx,
  catalogAccess: CatalogAccess,
  principal: Principal,
  p: PlaylistRow,
  fromRank: number,
  limit: number,
) {
  const rows = await tx
    .selectFrom('playlist_item')
    .selectAll()
    .where('playlist_id', '=', p.id)
    .where('rank', '>=', fromRank)
    .orderBy('rank')
    .limit(limit + 1)
    .execute();
  const page = rows.slice(0, limit);
  const resolved = await resolveRefs(
    tx,
    catalogAccess,
    principal,
    page.map((i) => ({ type: i.ref_type, id: i.ref_id })),
  );
  const last = page.at(-1);
  return {
    items: page.map((i, idx) => {
      const r = resolved[idx] as ResolvedRef;
      return {
        item_id: i.id,
        position: i.rank,
        ref_type: i.ref_type,
        ref_id: i.ref_id,
        title: r.title,
        subtitle: r.subtitle,
        ...(r.primary_release_id === undefined ? {} : { primary_release_id: r.primary_release_id }),
        ownership: r.ownership,
        playability: r.playability,
        added_at: i.added_at.toISOString(),
      };
    }),
    next_cursor:
      rows.length > limit && last
        ? ctx.cursors.encode(itemsScope(principal, p.id), [p.version, last.rank + 1])
        : null,
  };
}

/** The playlist with its first page of items. `version` matches the items returned. */
export function playlistView(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  playlist: Pick<PlaylistRow, 'id'>,
) {
  return readSnapshot(ctx.db, async (tx) => {
    const p = await ownPlaylist(tx, principal, playlist.id);
    const itemCount = await count(tx, p.id);
    const page = await itemsPage(ctx, tx, catalogAccess, principal, p, 0, PLAYLIST_ITEMS_PAGE);
    return {
      playlist_id: p.id,
      title: p.title,
      description: p.description,
      visibility: p.visibility,
      version: p.version,
      created_at: p.created_at.toISOString(),
      updated_at: p.updated_at.toISOString(),
      item_count: itemCount,
      items: page.items,
      items_next_cursor: page.next_cursor,
    };
  });
}

/** Later pages of a playlist's items. A cursor from an older version is refused (409). */
export function listPlaylistItems(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  id: string,
  q: { limit: number; cursor?: string | undefined },
) {
  const pos = ctx.cursors.decode(itemsScope(principal, id), q.cursor);
  return readSnapshot(ctx.db, async (tx) => {
    const p = await ownPlaylist(tx, principal, id);
    if (pos && pos[0] !== p.version)
      throw errors.invalidState(
        'The playlist changed since this page was read; read it again from the first page.',
      );
    const fromRank = pos ? Number(pos[1]) : 0;
    return itemsPage(ctx, tx, catalogAccess, principal, p, fromRank, q.limit);
  });
}

async function ownPlaylist(db: DbOrTx, principal: Principal, id: string, lock = false) {
  let q = db
    .selectFrom('playlist')
    .selectAll()
    .where('id', '=', id)
    .where('owner_user_id', '=', principal.userId);
  if (lock) q = q.forUpdate();
  const p = await q.executeTakeFirst();
  if (!p) throw errors.notFound();
  return p;
}

export function getPlaylist(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  id: string,
) {
  return playlistView(ctx, catalogAccess, principal, { id });
}

export async function createPlaylist(
  db: DbOrTx,
  principal: Principal,
  input: { title: string; description?: string | undefined },
  items: ItemRef[] = [],
): Promise<PlaylistRow> {
  const id = newId('playlist');
  const p = await db
    .insertInto('playlist')
    .values({
      id,
      owner_user_id: principal.userId,
      title: input.title,
      description: input.description ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const rows = items.slice(0, MAX_PLAYLIST_ITEMS).map((it, rank) => ({
    id: newId('playlistItem'),
    playlist_id: id,
    rank,
    ref_type: it.ref_type,
    ref_id: it.ref_id,
  }));
  // Chunked to stay well below the 65,535 bind-parameter limit of one statement.
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insertInto('playlist_item')
      .values(rows.slice(i, i + 1000))
      .execute();
  }
  return p;
}

/**
 * Runs a mutation under a row lock with optimistic concurrency: the caller's
 * If-Match version must equal the stored version (412 otherwise), and every
 * successful mutation increments it (concurrent edit safety, PB Phase 13).
 */
async function mutate(
  db: Db,
  principal: Principal,
  id: string,
  expectedVersion: number,
  fn: (tx: DbOrTx, p: PlaylistRow) => Promise<void>,
): Promise<PlaylistRow> {
  return db.transaction().execute(async (tx) => {
    const p = await ownPlaylist(tx, principal, id, true);
    if (p.version !== expectedVersion) throw errors.preconditionFailed();
    await fn(tx, p);
    return tx
      .updateTable('playlist')
      .set({ version: p.version + 1, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export function updatePlaylist(
  db: Db,
  principal: Principal,
  id: string,
  version: number,
  patch: { title?: string | undefined; description?: string | null | undefined },
) {
  return mutate(db, principal, id, version, async (tx) => {
    await tx
      .updateTable('playlist')
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
      })
      .where('id', '=', id)
      .execute();
  });
}

export async function deletePlaylist(
  db: Db,
  principal: Principal,
  id: string,
  version: number,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const p = await ownPlaylist(tx, principal, id, true);
    if (p.version !== version) throw errors.preconditionFailed();
    await tx.deleteFrom('playlist').where('id', '=', id).execute();
  });
}

async function count(tx: DbOrTx, playlistId: string): Promise<number> {
  const r = await tx
    .selectFrom('playlist_item')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('playlist_id', '=', playlistId)
    .executeTakeFirstOrThrow();
  return r.n;
}

/**
 * Adds an item. A private source can be added only by its owner, and adding it
 * never makes it visible to anyone else (LIB-004). Items store references only.
 */
export function addPlaylistItem(
  db: Db,
  principal: Principal,
  id: string,
  version: number,
  item: ItemRef & { position?: number | undefined },
) {
  return mutate(db, principal, id, version, async (tx) => {
    await assertRefAccessible(tx, principal, { type: item.ref_type, id: item.ref_id });
    const n = await count(tx, id);
    if (n >= MAX_PLAYLIST_ITEMS)
      throw errors.unprocessable('UNPROCESSABLE', 'The playlist is full.');
    const pos = Math.min(item.position ?? n, n);
    await tx
      .updateTable('playlist_item')
      .set((eb) => ({ rank: eb('rank', '+', 1) }))
      .where('playlist_id', '=', id)
      .where('rank', '>=', pos)
      .execute();
    await tx
      .insertInto('playlist_item')
      .values({
        id: newId('playlistItem'),
        playlist_id: id,
        rank: pos,
        ref_type: item.ref_type,
        ref_id: item.ref_id,
      })
      .execute();
  });
}

export function removePlaylistItem(
  db: Db,
  principal: Principal,
  id: string,
  version: number,
  itemId: string,
) {
  return mutate(db, principal, id, version, async (tx) => {
    const removed = await tx
      .deleteFrom('playlist_item')
      .where('id', '=', itemId)
      .where('playlist_id', '=', id)
      .returning('rank')
      .executeTakeFirst();
    if (!removed) throw errors.notFound();
    await tx
      .updateTable('playlist_item')
      .set((eb) => ({ rank: eb('rank', '-', 1) }))
      .where('playlist_id', '=', id)
      .where('rank', '>', removed.rank)
      .execute();
  });
}

export function movePlaylistItem(
  db: Db,
  principal: Principal,
  id: string,
  version: number,
  itemId: string,
  position: number,
) {
  return mutate(db, principal, id, version, async (tx) => {
    const item = await tx
      .selectFrom('playlist_item')
      .select('rank')
      .where('id', '=', itemId)
      .where('playlist_id', '=', id)
      .executeTakeFirst();
    if (!item) throw errors.notFound();
    const n = await count(tx, id);
    const to = Math.min(position, n - 1);
    const from = item.rank;
    if (to === from) return;
    // The (playlist_id, rank) unique constraint is deferred, so ranks may collide mid-transaction.
    if (to > from) {
      await tx
        .updateTable('playlist_item')
        .set((eb) => ({ rank: eb('rank', '-', 1) }))
        .where('playlist_id', '=', id)
        .where('rank', '>', from)
        .where('rank', '<=', to)
        .execute();
    } else {
      await tx
        .updateTable('playlist_item')
        .set((eb) => ({ rank: eb('rank', '+', 1) }))
        .where('playlist_id', '=', id)
        .where('rank', '>=', to)
        .where('rank', '<', from)
        .execute();
    }
    await tx.updateTable('playlist_item').set({ rank: to }).where('id', '=', itemId).execute();
  });
}

export async function listPlaylists(
  ctx: AppContext,
  principal: Principal,
  q: { limit: number; cursor?: string | undefined },
) {
  const scope = { userId: principal.userId, query: 'playlists' };
  const pos = ctx.cursors.decode(scope, q.cursor);
  let query = ctx.db
    .selectFrom('playlist as p')
    .select((eb) => [
      'p.id',
      'p.title',
      'p.version',
      'p.updated_at',
      eb
        .selectFrom('playlist_item as i')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('i.playlist_id', '=', 'p.id')
        .as('item_count'),
    ])
    .where('p.owner_user_id', '=', principal.userId);
  if (pos) {
    const [at, id] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('p.updated_at', '<', new Date(at)),
        eb.and([eb('p.updated_at', '=', new Date(at)), eb('p.id', '<', id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('p.updated_at', 'desc')
    .orderBy('p.id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      playlist_id: r.id,
      title: r.title,
      item_count: r.item_count ?? 0,
      version: r.version,
      updated_at: r.updated_at.toISOString(),
    })),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode(scope, [last.updated_at.toISOString(), last.id])
        : null,
  };
}
