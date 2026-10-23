import { sql } from 'kysely';
import type { ValidationSection } from '../../platform/validation.js';
import { koreanDay } from '../../platform/validation.js';

/**
 * Saving to the library and making or editing playlists count as activity.
 * `playlist_mixers` counts the people with a playlist that holds both a catalog
 * recording and their own audio (H2, ADR-0031); titles are never read.
 */
export const libraryValidationSection: ValidationSection = {
  name: 'library',
  async activeDays(db, userIds) {
    if (userIds.length === 0) return [];
    const saved = db
      .selectFrom('library_item')
      .select(['user_id', koreanDay('saved_at').as('day')])
      .where('user_id', 'in', userIds);
    const created = db
      .selectFrom('playlist')
      .select(['owner_user_id as user_id', koreanDay('created_at').as('day')])
      .where('owner_user_id', 'in', userIds);
    const edited = db
      .selectFrom('playlist')
      .select(['owner_user_id as user_id', koreanDay('updated_at').as('day')])
      .where('owner_user_id', 'in', userIds);
    const added = db
      .selectFrom('playlist_item as i')
      .innerJoin('playlist as p', 'p.id', 'i.playlist_id')
      .select(['p.owner_user_id as user_id', koreanDay('i.added_at').as('day')])
      .where('p.owner_user_id', 'in', userIds);
    const rows = await saved.union(created).union(edited).union(added).execute();
    return rows.map((r) => ({ userId: r.user_id, day: r.day }));
  },
  async counts(db, userIds) {
    if (userIds.length === 0) return { playlist_mixers: 0 };
    const row = await db
      .selectFrom('playlist as p')
      .select((eb) => eb.fn.count<number>('p.owner_user_id').distinct().as('n'))
      .where('p.owner_user_id', 'in', userIds)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('playlist_item as c')
            .select(sql`1`.as('one'))
            .whereRef('c.playlist_id', '=', 'p.id')
            .where('c.ref_type', '=', 'recording'),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('playlist_item as o')
            .innerJoin('audio_source as a', 'a.id', 'o.ref_id')
            .select(sql`1`.as('one'))
            .whereRef('o.playlist_id', '=', 'p.id')
            .where('o.ref_type', '=', 'audio_source')
            .where('a.origin', 'in', ['private_upload', 'audio_log']),
        ),
      )
      .executeTakeFirstOrThrow();
    return { playlist_mixers: row.n };
  },
};
