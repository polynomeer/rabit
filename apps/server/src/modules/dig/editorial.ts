import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { audit } from '../../platform/audit.js';
import type { Db } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { availableReleases } from './crates.js';
import type { DigDeps } from './service.js';

/**
 * Editorial shelves (ADR-0029): operators curate releases for Home, targeted by
 * territory and a time window. Listeners see a shelf only while it is live in their
 * licence country, and only its releases available there; curated order is kept.
 */
export const MAX_ITEMS = 50;
const MAX_LIVE_SHELVES = 10;
const SHELF_SIZE = 24;

export const shelfInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  position: z.number().int().min(0).max(1000).default(0),
  territories: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(50)
    .default([]),
  starts_at: z.iso.datetime().nullable().default(null),
  ends_at: z.iso.datetime().nullable().default(null),
  published: z.boolean().default(false),
  items: z
    .array(
      z.strictObject({
        release_id: z.string().regex(/^rel_[0-9A-HJKMNP-TV-Z]{26}$/),
        note: z.string().trim().max(200).nullable().default(null),
      }),
    )
    .max(MAX_ITEMS)
    .default([]),
  reason: z.string().min(3).max(500),
});
export type ShelfInput = z.infer<typeof shelfInput>;

/** The shelves live for this listener, each with the releases available to them. */
export async function liveShelves(ctx: AppContext, deps: DigDeps, principal: Principal) {
  const country = await deps.licenseCountry(ctx.db, principal.userId);
  const shelves = await ctx.db
    .selectFrom('editorial_shelf')
    .select(['id', 'title', 'description'])
    .where('published', '=', true)
    .where((eb) => eb.or([eb('starts_at', 'is', null), eb('starts_at', '<=', sql<Date>`now()`)]))
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<Date>`now()`)]))
    .where((eb) =>
      country
        ? eb.or([
            sql<boolean>`cardinality(territories) = 0`,
            sql<boolean>`${country} = ANY(territories)`,
          ])
        : sql<boolean>`cardinality(territories) = 0`,
    )
    .orderBy('position')
    .orderBy('id')
    .limit(MAX_LIVE_SHELVES)
    .execute();
  const out = [];
  for (const s of shelves) {
    const rows = await ctx.db
      .selectFrom('editorial_shelf_item as i')
      .innerJoin('release as r', 'r.id', 'i.release_id')
      .select(['r.id', 'r.title', 'r.release_type', 'r.release_date', 'r.label_id', 'i.note'])
      .where('i.shelf_id', '=', s.id)
      .orderBy('i.position')
      .execute();
    const notes = new Map(rows.map((r) => [r.id, r.note]));
    const items = await availableReleases(ctx, deps, principal, rows, SHELF_SIZE);
    if (items.length === 0) continue;
    out.push({
      shelf_id: s.id,
      title: s.title,
      description: s.description,
      items: items.map((i) => ({ ...i, note: notes.get(i.release.release_id) ?? null })),
    });
  }
  return { shelves: out };
}

/** Every shelf for operators, drafts and ended ones included. */
export async function allShelves(db: Db) {
  const shelves = await db
    .selectFrom('editorial_shelf')
    .selectAll()
    .orderBy('position')
    .orderBy('id')
    .execute();
  const items = shelves.length
    ? await db
        .selectFrom('editorial_shelf_item as i')
        .innerJoin('release as r', 'r.id', 'i.release_id')
        .select(['i.shelf_id', 'i.release_id', 'i.note', 'r.title'])
        .where(
          'i.shelf_id',
          'in',
          shelves.map((s) => s.id),
        )
        .orderBy('i.position')
        .execute()
    : [];
  return shelves.map((s) => ({
    shelf_id: s.id,
    title: s.title,
    description: s.description,
    position: s.position,
    territories: s.territories,
    starts_at: s.starts_at?.toISOString() ?? null,
    ends_at: s.ends_at?.toISOString() ?? null,
    published: s.published,
    updated_by: s.updated_by,
    updated_at: s.updated_at.toISOString(),
    items: items
      .filter((i) => i.shelf_id === s.id)
      .map((i) => ({ release_id: i.release_id, title: i.title, note: i.note })),
  }));
}

async function shelfView(db: Db, id: string) {
  const shelf = (await allShelves(db)).find((s) => s.shelf_id === id);
  if (!shelf) throw errors.notFound();
  return shelf;
}

function check(input: ShelfInput) {
  const ids = input.items.map((i) => i.release_id);
  if (new Set(ids).size !== ids.length) {
    throw errors.validation(
      { items: 'duplicate release' },
      'A release can be on a shelf only once.',
    );
  }
  if (input.starts_at && input.ends_at && input.ends_at <= input.starts_at) {
    throw errors.validation({ ends_at: 'before starts_at' }, 'The shelf must end after it starts.');
  }
}

/** Creates a shelf, or replaces one with its items. Audited with the reason. */
export async function saveShelf(
  db: Db,
  operator: Principal,
  id: string | null,
  input: ShelfInput,
  correlationId: string,
) {
  check(input);
  const shelfId = id ?? newId('editorialShelf');
  await db.transaction().execute(async (tx) => {
    if (input.items.length > 0) {
      const found = await tx
        .selectFrom('release')
        .select('id')
        .where(
          'id',
          'in',
          input.items.map((i) => i.release_id),
        )
        .execute();
      if (found.length !== input.items.length) {
        throw errors.validation({ items: 'unknown release' }, 'Unknown release.');
      }
    }
    const values = {
      title: input.title,
      description: input.description,
      position: input.position,
      territories: input.territories,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      published: input.published,
      updated_by: operator.userId,
      updated_at: new Date(),
    };
    if (id) {
      const r = await tx
        .updateTable('editorial_shelf')
        .set(values)
        .where('id', '=', id)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) throw errors.notFound();
      await tx.deleteFrom('editorial_shelf_item').where('shelf_id', '=', id).execute();
    } else {
      await tx
        .insertInto('editorial_shelf')
        .values({ id: shelfId, ...values })
        .execute();
    }
    if (input.items.length > 0) {
      await tx
        .insertInto('editorial_shelf_item')
        .values(
          input.items.map((i, position) => ({
            shelf_id: shelfId,
            position,
            release_id: i.release_id,
            note: i.note,
          })),
        )
        .execute();
    }
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: id ? 'editorial_shelf.updated' : 'editorial_shelf.created',
      subjectType: 'editorial_shelf',
      subjectId: shelfId,
      reason: input.reason,
      correlationId,
      details: {
        published: input.published,
        territories: input.territories,
        items: input.items.length,
      },
    });
  });
  return shelfView(db, shelfId);
}

export async function deleteShelf(
  db: Db,
  operator: Principal,
  id: string,
  reason: string,
  correlationId: string,
) {
  await db.transaction().execute(async (tx) => {
    const r = await tx.deleteFrom('editorial_shelf').where('id', '=', id).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw errors.notFound();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'editorial_shelf.deleted',
      subjectType: 'editorial_shelf',
      subjectId: id,
      reason,
      correlationId,
    });
  });
}
