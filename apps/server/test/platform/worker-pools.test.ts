import { afterAll, describe, expect, it } from 'vitest';
import { handlersForPool, mediaBacklogEmf } from '../../src/app/worker.js';
import { queueHealth } from '../../src/platform/jobs/health.js';
import { enqueue } from '../../src/platform/jobs/queue.js';
import { JobRunner, type JobHandler } from '../../src/platform/jobs/runner.js';
import { ulid } from '../../src/platform/ids.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

const handler = (kind: string, extra: Partial<JobHandler> = {}): JobHandler => ({
  kind,
  leaseMs: 5_000,
  handle: () => Promise.resolve(),
  ...extra,
});

describe('worker pools (ADR-0005 amendment 2026-10-20)', () => {
  it('splits handlers between the general and media pools', () => {
    const hs = [handler('a'), handler('b', { pool: 'media' }), handler('c', { pool: 'general' })];
    expect(handlersForPool(hs, 'all').map((h) => h.kind)).toEqual(['a', 'b', 'c']);
    expect(handlersForPool(hs, 'general').map((h) => h.kind)).toEqual(['a', 'c']);
    expect(handlersForPool(hs, 'media').map((h) => h.kind)).toEqual(['b']);
  });

  it('claims higher-priority kinds first, even when lower ones waited longer', async () => {
    const upload = `t.upload.${ulid()}`;
    const bulk = `t.bulk.${ulid()}`;
    for (let i = 0; i < 3; i++) {
      await enqueue(ctx.db, {
        kind: bulk,
        payload: {},
        dedupeKey: `${bulk}:${i}`,
        runAfter: new Date(Date.now() - 600_000),
      });
    }
    await enqueue(ctx.db, { kind: upload, payload: {}, dedupeKey: `${upload}:1` });
    const order: string[] = [];
    const record = (kind: string) => () => {
      order.push(kind);
      return Promise.resolve();
    };
    const runner = new JobRunner({
      db: ctx.db,
      log: ctx.log,
      concurrency: 1,
      handlers: [
        handler(bulk, { pool: 'media', priority: 1, handle: record(bulk) }),
        handler(upload, { pool: 'media', handle: record(upload) }),
      ],
    });
    await runner.drain();
    expect(order).toEqual([upload, bulk, bulk, bulk]);
  });

  it('reports the backlog per kind, with zeros for idle kinds', async () => {
    const busy = `t.busy.${ulid()}`;
    const idle = `t.idle.${ulid()}`;
    await enqueue(ctx.db, {
      kind: busy,
      payload: {},
      dedupeKey: `${busy}:1`,
      runAfter: new Date(Date.now() - 300_000),
    });
    const h = await queueHealth(ctx.db, [busy, idle]);
    expect(h.byKind[busy]?.ready).toBe(1);
    expect(h.byKind[busy]?.oldestSeconds).toBeGreaterThanOrEqual(299);
    expect(h.byKind[idle]).toEqual({ ready: 0, oldestSeconds: 0 });
    await ctx.db.deleteFrom('job').where('kind', '=', busy).execute();
  });

  it('writes the media backlog as an Embedded Metric Format line', () => {
    const emf = mediaBacklogEmf('Rabit/staging', 7, 42);
    expect(emf).toMatchObject({
      _aws: {
        CloudWatchMetrics: [
          {
            Namespace: 'Rabit/staging',
            Dimensions: [[]],
            Metrics: [
              { Name: 'MediaJobsReady', Unit: 'Count' },
              { Name: 'MediaJobOldestSeconds', Unit: 'Seconds' },
            ],
          },
        ],
      },
      MediaJobsReady: 7,
      MediaJobOldestSeconds: 42,
    });
  });
});
