import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { metrics } from '../../platform/metrics.js';

/**
 * Playback quality (QoE) reports, one per session from the client (slo.md "Play
 * start (client)" and "Rebuffering"). Values only feed aggregate metrics labelled
 * by platform: nothing about the listener or the track is stored.
 */
export const qualityReport = z.strictObject({
  platform: z.enum(['web', 'ios']),
  /** Choosing the track to the first audible frame; null when it never started. */
  startup_ms: z.number().int().min(0).max(120_000).nullable(),
  played_ms: z
    .number()
    .int()
    .min(0)
    .max(6 * 3_600_000),
  stall_count: z.number().int().min(0).max(10_000),
  stall_ms: z
    .number()
    .int()
    .min(0)
    .max(6 * 3_600_000),
  /** Why playback failed, if it did: network, media (decode/format) or other. */
  error: z.enum(['network', 'media', 'other']).nullable(),
});
export type QualityReport = z.infer<typeof qualityReport>;

/** Slack for clocks and the report's own delay. */
const TOLERANCE_MS = 120_000;

export async function recordQualityReport(
  db: Db,
  principal: Principal,
  sessionId: string,
  r: QualityReport,
): Promise<void> {
  const row = await db
    .updateTable('playback_session')
    .set({ quality_reported_at: sql<Date>`now()` })
    .where('id', '=', sessionId)
    .where('user_id', '=', principal.userId)
    .where('quality_reported_at', 'is', null)
    .returning(sql<number>`extract(epoch FROM now() - issued_at) * 1000`.as('elapsed_ms'))
    .executeTakeFirst();
  if (!row) {
    const exists = await db
      .selectFrom('playback_session')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', principal.userId)
      .executeTakeFirst();
    if (!exists) throw errors.notFound();
    metrics.playbackQualityReports.inc({ platform: r.platform, outcome: 'duplicate' });
    return;
  }
  // The session's own age bounds what it can have played or waited for.
  if (r.played_ms + r.stall_ms + (r.startup_ms ?? 0) > row.elapsed_ms + TOLERANCE_MS) {
    metrics.playbackQualityReports.inc({ platform: r.platform, outcome: 'implausible' });
    return;
  }
  const labels = { platform: r.platform };
  metrics.playbackQualityReports.inc({ ...labels, outcome: 'accepted' });
  if (r.startup_ms !== null) metrics.playbackStartup.observe(labels, r.startup_ms / 1000);
  metrics.playbackPlayedSeconds.inc(labels, r.played_ms / 1000);
  metrics.playbackStallSeconds.inc(labels, r.stall_ms / 1000);
  metrics.playbackStalls.inc(labels, r.stall_count);
  if (r.error) metrics.playbackClientErrors.inc({ ...labels, code: r.error });
}
