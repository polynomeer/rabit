import { afterAll, describe, expect, it } from 'vitest';
import { queueHealth } from '../../src/platform/jobs/health.js';
import { enqueue } from '../../src/platform/jobs/queue.js';
import { ulid } from '../../src/platform/ids.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

describe('queue health', () => {
  it('reports counts per status and the age of the oldest ready job', async () => {
    const kind = `t.health.${ulid()}`;
    await enqueue(ctx.db, {
      kind,
      payload: {},
      dedupeKey: `${kind}:1`,
      runAfter: new Date(Date.now() - 120_000),
    });
    const h = await queueHealth(ctx.db);
    expect(h.byStatus['queued']).toBeGreaterThanOrEqual(1);
    expect(h.oldestQueuedSeconds).toBeGreaterThanOrEqual(119);
    expect(h.outboxPending).toBeGreaterThanOrEqual(0);
    await ctx.db.deleteFrom('job').where('kind', '=', kind).execute();
  });
});
