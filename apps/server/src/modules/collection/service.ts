import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { PhysicalItemTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { entitySummaries, type EntitySummary } from '../catalog/index.js';

/**
 * Physical Collection, manual registration (COL-001/002/007). Every item is the
 * owner's own record: `self_declared` ("I own this CD"), never proof of copyright
 * and never a source of playback rights (COL-003). Nothing here reads or writes
 * entitlement data; private to the owner like the rest of the archive.
 */
export type PhysicalFormat = PhysicalItemTable['format'];

export interface PhysicalItemInput {
  format: PhysicalFormat;
  title: string;
  artist_name?: string | null | undefined;
  barcode?: string | null | undefined;
  catalog_number?: string | null | undefined;
  release_id?: string | null | undefined;
  notes?: string | null | undefined;
}

type Row = Selectable<PhysicalItemTable>;

function view(r: Row, releases: Map<string, EntitySummary>) {
  const release = r.release_id ? releases.get(r.release_id) : undefined;
  return {
    physical_item_id: r.id,
    format: r.format,
    title: r.title,
    artist_name: r.artist_name,
    barcode: r.barcode,
    catalog_number: r.catalog_number,
    // The edition the owner says this copy is; not an identification (COL-004 is M2).
    release: release ? { release_id: release.entity_id, title: release.name } : null,
    notes: r.notes,
    verification_state: r.verification_state,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

async function views(db: DbOrTx, rows: Row[]) {
  const releases = await entitySummaries(
    db,
    rows.map((r) => r.release_id).filter((x): x is string => x !== null),
  );
  return rows.map((r) => view(r, releases));
}

async function assertRelease(db: DbOrTx, releaseId: string | null | undefined): Promise<void> {
  if (!releaseId) return;
  const found = await db
    .selectFrom('release')
    .select('id')
    .where('id', '=', releaseId)
    .executeTakeFirst();
  if (!found) throw errors.validation({ release_id: 'unknown release' });
}

async function getOwn(db: DbOrTx, principal: Principal, id: string): Promise<Row> {
  const row = await db
    .selectFrom('physical_item')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  return row;
}

export async function createPhysicalItem(
  db: DbOrTx,
  principal: Principal,
  input: PhysicalItemInput,
) {
  await assertRelease(db, input.release_id);
  const row = await db
    .insertInto('physical_item')
    .values({
      id: newId('physicalItem'),
      user_id: principal.userId,
      format: input.format,
      title: input.title,
      artist_name: input.artist_name ?? null,
      barcode: input.barcode ?? null,
      catalog_number: input.catalog_number ?? null,
      release_id: input.release_id ?? null,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return (await views(db, [row]))[0];
}

export async function getPhysicalItem(db: DbOrTx, principal: Principal, id: string) {
  return (await views(db, [await getOwn(db, principal, id)]))[0];
}

export async function updatePhysicalItem(
  db: DbOrTx,
  principal: Principal,
  id: string,
  patch: { [K in keyof PhysicalItemInput]?: PhysicalItemInput[K] | undefined },
) {
  await getOwn(db, principal, id);
  await assertRelease(db, patch.release_id);
  const row = await db
    .updateTable('physical_item')
    .set({ ...patch, updated_at: new Date() })
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return (await views(db, [row]))[0];
}

export async function deletePhysicalItem(db: DbOrTx, principal: Principal, id: string) {
  const res = await db
    .deleteFrom('physical_item')
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (Number(res.numDeletedRows) === 0) throw errors.notFound();
}

export async function listPhysicalItems(
  ctx: AppContext,
  principal: Principal,
  q: { limit: number; cursor?: string | undefined },
) {
  const scope = { userId: principal.userId, query: 'physical-items' };
  const pos = ctx.cursors.decode(scope, q.cursor);
  let query = ctx.db
    .selectFrom('physical_item')
    .selectAll()
    .where('user_id', '=', principal.userId);
  if (pos) {
    const [at, id] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '<', new Date(at)),
        eb.and([eb('created_at', '=', new Date(at)), eb('id', '<', id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: await views(ctx.db, page),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode(scope, [last.created_at.toISOString(), last.id])
        : null,
  };
}
