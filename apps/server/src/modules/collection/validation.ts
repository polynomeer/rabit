import type { ValidationSection } from '../../platform/validation.js';
import { koreanDay } from '../../platform/validation.js';

/** H5 reads a collector as someone with 20 or more records (screener question 5). */
export const COLLECTOR_THRESHOLD = 20;

/**
 * Adding a record counts as activity. `collectors` counts people with at least one
 * record, `collectors_20_plus` those with 20 or more (H5, ADR-0031).
 */
export const collectionValidationSection: ValidationSection = {
  name: 'collection',
  async activeDays(db, userIds) {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectFrom('physical_item')
      .select(['user_id', koreanDay('created_at').as('day')])
      .distinct()
      .where('user_id', 'in', userIds)
      .execute();
    return rows.map((r) => ({ userId: r.user_id, day: r.day }));
  },
  async counts(db, userIds) {
    if (userIds.length === 0) return { collectors: 0, collectors_20_plus: 0 };
    const perUser = db
      .selectFrom('physical_item')
      .select(['user_id', (eb) => eb.fn.countAll<number>().as('items')])
      .where('user_id', 'in', userIds)
      .groupBy('user_id')
      .as('u');
    const row = await db
      .selectFrom(perUser)
      .select((eb) => [
        eb.fn.countAll<number>().as('collectors'),
        eb.fn
          .countAll<number>()
          .filterWhere('u.items', '>=', COLLECTOR_THRESHOLD)
          .as('collectors_20_plus'),
      ])
      .executeTakeFirstOrThrow();
    return {
      collectors: row.collectors,
      collectors_20_plus: row.collectors_20_plus,
    };
  },
};
