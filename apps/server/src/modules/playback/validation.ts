import type { ValidationSection } from '../../platform/validation.js';
import { koreanDay } from '../../platform/validation.js';

/**
 * Starting playback counts as activity. `own_audio_players` counts the people who
 * played their own audio (an upload or an Audio Log) at least once; which audio is
 * never read (H2, ADR-0032).
 */
export const playbackValidationSection: ValidationSection = {
  name: 'playback',
  async activeDays(db, userIds) {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectFrom('playback_session')
      .select(['user_id', koreanDay('issued_at').as('day')])
      .distinct()
      .where('user_id', 'in', userIds)
      .execute();
    return rows.map((r) => ({ userId: r.user_id, day: r.day }));
  },
  async counts(db, userIds) {
    if (userIds.length === 0) return { own_audio_players: 0 };
    const row = await db
      .selectFrom('playback_session as s')
      .innerJoin('audio_source as a', 'a.id', 's.audio_source_id')
      .select((eb) => eb.fn.count<number>('s.user_id').distinct().as('n'))
      .where('s.user_id', 'in', userIds)
      .where('a.origin', 'in', ['private_upload', 'audio_log'])
      .executeTakeFirstOrThrow();
    return { own_audio_players: row.n };
  },
};
