import type { Db } from '../platform/db/db.js';
import { enqueue } from '../platform/jobs/queue.js';

/**
 * Enqueues periodic jobs. The dedupe key contains the time bucket, so several
 * worker processes running the scheduler create each periodic job only once.
 */
export async function enqueueDueSchedules(
  db: Db,
  schedules: { kind: string; everyMs: number }[],
  now = Date.now(),
): Promise<void> {
  for (const s of schedules) {
    const bucket = Math.floor(now / s.everyMs);
    await enqueue(db, {
      kind: s.kind,
      payload: { bucket },
      dedupeKey: `schedule:${s.kind}:${bucket}`,
      maxAttempts: 3,
    });
  }
}
