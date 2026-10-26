import type { ValidationSection } from '../../platform/validation.js';
import { koreanDay } from '../../platform/validation.js';

/** Uploads and Audio Logs count as activity; titles and audio are never read. */
export const audioValidationSection: ValidationSection = {
  name: 'audio',
  async activeDays(db, userIds) {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectFrom('audio_source')
      .select(['created_by', koreanDay('created_at').as('day')])
      .distinct()
      .where('created_by', 'in', userIds)
      .where('origin', 'in', ['private_upload', 'audio_log'])
      .execute();
    return rows.flatMap((r) => (r.created_by ? [{ userId: r.created_by, day: r.day }] : []));
  },
};
