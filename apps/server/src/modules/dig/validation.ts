import { sql } from 'kysely';
import type { ValidationSection } from '../../platform/validation.js';
import { koreanDay } from '../../platform/validation.js';

/**
 * Starting a DIG session or a Blind Digging round counts as activity. A DIG session
 * is kept when it was saved or one of its trail steps was saved (H3, ADR-0031).
 */
export const digValidationSection: ValidationSection = {
  name: 'dig',
  async activeDays(db, userIds) {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectFrom('dig_session')
      .select(['user_id', koreanDay('started_at').as('day')])
      .where('user_id', 'in', userIds)
      .union(
        db
          .selectFrom('blind_dig')
          .select(['user_id', koreanDay('created_at').as('day')])
          .where('user_id', 'in', userIds),
      )
      .execute();
    return rows.map((r) => ({ userId: r.user_id, day: r.day }));
  },
  async counts(db, userIds) {
    if (userIds.length === 0) return { dig_sessions: 0, kept_dig_sessions: 0, diggers: 0 };
    const sessions = await db
      .selectFrom('dig_session as s')
      .select((eb) => [
        eb.fn.countAll<number>().as('n'),
        eb.fn
          .countAll<number>()
          .filterWhere((w) =>
            w.or([
              w('s.saved', '=', true),
              w.exists(
                w
                  .selectFrom('dig_trail_node as t')
                  .select(sql`1`.as('one'))
                  .whereRef('t.session_id', '=', 's.id')
                  .where('t.saved', '=', true),
              ),
            ]),
          )
          .as('kept'),
      ])
      .where('s.user_id', 'in', userIds)
      .executeTakeFirstOrThrow();
    const diggers = await db
      .selectFrom(
        db
          .selectFrom('dig_session')
          .select('user_id')
          .where('user_id', 'in', userIds)
          .union(db.selectFrom('blind_dig').select('user_id').where('user_id', 'in', userIds))
          .as('d'),
      )
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    return {
      dig_sessions: sessions.n,
      kept_dig_sessions: sessions.kept,
      diggers: diggers.n,
    };
  },
};
