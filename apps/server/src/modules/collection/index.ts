import type { Module } from '../../app/modules.js';
import { countsBy, type SupportSection } from '../../platform/support.js';
import type { AccountDataDeleter } from '../identity/index.js';
import type { ExportSection } from '../library/index.js';
import { collectionRoutes } from './routes.js';

export { validGtin } from './routes.js';

/** Physical items are personal data (notes, what the user owns): removed with the account. */
export const deleteAccountCollection: AccountDataDeleter = async (ctx, account) => {
  await ctx.db.deleteFrom('physical_item').where('user_id', '=', account.userId).execute();
};

/** The Physical Collection belongs to the user's archive export (LIB-007). */
export const collectionExportSection: ExportSection = async (ctx, userId) => {
  const rows = await ctx.db
    .selectFrom('physical_item')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute();
  return [
    'physical_items',
    rows.map((r) => ({
      physical_item_id: r.id,
      format: r.format,
      title: r.title,
      artist_name: r.artist_name,
      barcode: r.barcode,
      catalog_number: r.catalog_number,
      release_id: r.release_id,
      notes: r.notes,
      verification_state: r.verification_state,
      created_at: r.created_at.toISOString(),
    })),
  ];
};

/** Support sees counts by format and verification only, never titles or notes (R18). */
export const collectionSupportSection: SupportSection = {
  name: 'collection',
  async read(db, { userId }) {
    const rows = await db
      .selectFrom('physical_item')
      .select(['format as k', (eb) => eb.fn.countAll<number>().as('n')])
      .where('user_id', '=', userId)
      .groupBy('format')
      .execute();
    const states = await db
      .selectFrom('physical_item')
      .select(['verification_state as k', (eb) => eb.fn.countAll<number>().as('n')])
      .where('user_id', '=', userId)
      .groupBy('verification_state')
      .execute();
    return { physical_items_by_format: countsBy(rows), by_verification: countsBy(states) };
  },
};

export function collectionModule(): Module {
  return { name: 'collection', routes: collectionRoutes };
}
