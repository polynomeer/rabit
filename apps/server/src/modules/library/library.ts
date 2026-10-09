import type { AppContext } from '../../app/context.js';
import { isUniqueViolation, type DbOrTx } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { getOwnSource } from '../audio/index.js';
import { recordingExists, releaseExists } from '../catalog/index.js';
import type { CatalogAccess } from '../playback/index.js';
import { resolveRefs, type RefType, type ResolvedRef } from './resolve.js';

/** A reference must be visible to the caller before it can be saved (T05). */
export async function assertRefAccessible(
  db: DbOrTx,
  principal: Principal,
  ref: { type: RefType; id: string },
): Promise<void> {
  if (ref.type === 'audio_source') {
    const src = await getOwnSource(db, principal, ref.id);
    if (src.status === 'deleting') throw errors.notFound();
    return;
  }
  const exists =
    ref.type === 'recording' ? await recordingExists(db, ref.id) : await releaseExists(db, ref.id);
  if (!exists) throw errors.notFound();
}

interface ItemRow {
  id: string;
  ref_type: RefType;
  ref_id: string;
  origin: 'uploaded' | 'logged' | 'saved';
  note: string | null;
  saved_at: Date;
}

function itemView(row: ItemRow, r: ResolvedRef) {
  return {
    library_item_id: row.id,
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    origin: row.origin,
    title: r.title,
    subtitle: r.subtitle,
    note: row.note,
    saved_at: row.saved_at.toISOString(),
    ownership: r.ownership ?? 'private',
    playability: r.playability,
  };
}

async function itemViews(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  rows: readonly ItemRow[],
) {
  const resolved = await resolveRefs(
    ctx.db,
    catalogAccess,
    principal,
    rows.map((r) => ({ type: r.ref_type, id: r.ref_id })),
  );
  return rows.map((row, i) => itemView(row, resolved[i] as ResolvedRef));
}

export async function addLibraryItem(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  input: { ref_type: RefType; ref_id: string; note?: string | undefined },
) {
  await assertRefAccessible(ctx.db, principal, { type: input.ref_type, id: input.ref_id });
  try {
    const row = await ctx.db
      .insertInto('library_item')
      .values({
        id: newId('libraryItem'),
        user_id: principal.userId,
        ref_type: input.ref_type,
        ref_id: input.ref_id,
        origin: 'saved',
        note: input.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return (await itemViews(ctx, catalogAccess, principal, [row]))[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw errors.alreadyExists('This item is already in your library.');
    throw err;
  }
}

export async function listLibrary(
  ctx: AppContext,
  catalogAccess: CatalogAccess,
  principal: Principal,
  q: {
    ref_type?: RefType | undefined;
    ref_id?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  },
) {
  const scope = {
    userId: principal.userId,
    query: `library:${q.ref_type ?? 'all'}:${q.ref_id ?? '*'}`,
  };
  const pos = ctx.cursors.decode(scope, q.cursor);
  let query = ctx.db.selectFrom('library_item').selectAll().where('user_id', '=', principal.userId);
  if (q.ref_type) query = query.where('ref_type', '=', q.ref_type);
  // Only the caller's own rows are ever matched (user_id above), so an id the caller
  // cannot see simply yields an empty page.
  if (q.ref_id) query = query.where('ref_id', '=', q.ref_id);
  if (pos) {
    const [at, id] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('saved_at', '<', new Date(at)),
        eb.and([eb('saved_at', '=', new Date(at)), eb('id', '<', id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('saved_at', 'desc')
    .orderBy('id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await itemViews(ctx, catalogAccess, principal, page),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode(scope, [last.saved_at.toISOString(), last.id])
        : null,
  };
}

/** Removing a library item never revokes an entitlement (domain-model §1). */
export async function removeLibraryItem(
  db: DbOrTx,
  principal: Principal,
  id: string,
): Promise<void> {
  const res = await db
    .deleteFrom('library_item')
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (Number(res.numDeletedRows) === 0) throw errors.notFound();
}

/** AudioReady: the uploader's own audio appears in their Archive (Remember). */
export async function attachUploadToLibrary(db: DbOrTx, sourceId: string): Promise<void> {
  const src = await db
    .selectFrom('audio_source')
    .select(['id', 'origin', 'created_by', 'deleted_at'])
    .where('id', '=', sourceId)
    .executeTakeFirst();
  if (!src || src.origin === 'catalog' || !src.created_by || src.deleted_at !== null) return;
  await db
    .insertInto('library_item')
    .values({
      id: newId('libraryItem'),
      user_id: src.created_by,
      ref_type: 'audio_source',
      ref_id: src.id,
      origin: src.origin === 'audio_log' ? 'logged' : 'uploaded',
      note: null,
    })
    .onConflict((oc) => oc.columns(['user_id', 'ref_type', 'ref_id']).doNothing())
    .execute();
}
