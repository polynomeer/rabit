import { afterAll, describe, expect, it } from 'vitest';
import { dispatchOutbox, emit } from '../../src/platform/jobs/outbox.js';
import {
  backoffMs,
  claimJobs,
  enqueue,
  reclaimExpiredLeases,
  requeueJob,
} from '../../src/platform/jobs/queue.js';
import { JobRunner, PermanentJobError } from '../../src/platform/jobs/runner.js';
import { ulid } from '../../src/platform/ids.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

async function jobsOfKind(kind: string) {
  return ctx.db.selectFrom('job').selectAll().where('kind', '=', kind).execute();
}

describe('job queue', () => {
  it('deduplicates producers by dedupe key (T15)', async () => {
    const kind = `t.dedupe.${ulid()}`;
    expect(await enqueue(ctx.db, { kind, payload: {}, dedupeKey: `${kind}:1` })).toBe(true);
    expect(await enqueue(ctx.db, { kind, payload: {}, dedupeKey: `${kind}:1` })).toBe(false);
    expect(await jobsOfKind(kind)).toHaveLength(1);
  });

  it('never hands the same job to two concurrent claimers', async () => {
    const kind = `t.claim.${ulid()}`;
    for (let i = 0; i < 10; i++)
      await enqueue(ctx.db, { kind, payload: { i }, dedupeKey: `${kind}:${i}` });
    const [a, b] = await Promise.all([
      claimJobs(ctx.db, { workerId: 'a', kinds: [kind], limit: 10, leaseMs: 60_000 }),
      claimJobs(ctx.db, { workerId: 'b', kinds: [kind], limit: 10, leaseMs: 60_000 }),
    ]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('retries transient failures with backoff and dead-letters after max attempts', async () => {
    const kind = `t.retry.${ulid()}`;
    await enqueue(ctx.db, { kind, payload: {}, dedupeKey: `${kind}:1`, maxAttempts: 2 });
    let calls = 0;
    const runner = new JobRunner({
      db: ctx.db,
      log: ctx.log,
      concurrency: 1,
      handlers: [
        {
          kind,
          leaseMs: 5_000,
          handle: () => {
            calls++;
            return Promise.reject(new Error('transient'));
          },
        },
      ],
    });
    await runner.drain();
    let [job] = await jobsOfKind(kind);
    expect(job?.status).toBe('queued');
    expect(job?.run_after.getTime()).toBeGreaterThan(Date.now());
    await ctx.db
      .updateTable('job')
      .set({ run_after: new Date() })
      .where('kind', '=', kind)
      .execute();
    await runner.drain();
    [job] = await jobsOfKind(kind);
    expect(job?.status).toBe('dead');
    expect(calls).toBe(2);
    expect(await requeueJob(ctx.db, job!.id)).toBe(true);
  });

  it('dead-letters permanent failures immediately and runs onDead', async () => {
    const kind = `t.perm.${ulid()}`;
    await enqueue(ctx.db, { kind, payload: {}, dedupeKey: `${kind}:1` });
    let deadCalled = false;
    const runner = new JobRunner({
      db: ctx.db,
      log: ctx.log,
      concurrency: 1,
      handlers: [
        {
          kind,
          leaseMs: 5_000,
          handle: () => Promise.reject(new PermanentJobError('UNSUPPORTED_MEDIA')),
          onDead: () => {
            deadCalled = true;
            return Promise.resolve();
          },
        },
      ],
    });
    await runner.drain();
    const [job] = await jobsOfKind(kind);
    expect(job?.status).toBe('dead');
    expect(job?.attempts).toBe(1);
    expect(deadCalled).toBe(true);
  });

  it('reclaims expired leases from crashed workers', async () => {
    const kind = `t.lease.${ulid()}`;
    await enqueue(ctx.db, { kind, payload: {}, dedupeKey: `${kind}:1` });
    await claimJobs(ctx.db, { workerId: 'crashed', kinds: [kind], limit: 1, leaseMs: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(await reclaimExpiredLeases(ctx.db)).toBeGreaterThanOrEqual(1);
    expect((await jobsOfKind(kind))[0]?.status).toBe('queued');
  });

  it('computes bounded backoff', () => {
    for (let a = 1; a < 20; a++) {
      const ms = backoffMs(a);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(15 * 60_000);
    }
  });
});

describe('outbox', () => {
  it('fans out each event once per consumer, idempotently', async () => {
    const type = `TestEvent.${ulid()}`;
    const kindA = `t.consumer.a.${ulid()}`;
    const kindB = `t.consumer.b.${ulid()}`;
    const eventId = await emit(ctx.db, {
      type,
      schemaVersion: 1,
      subjectId: 'asr_x',
      privacyScope: 'system',
      payload: { state: 'ready' },
    });
    await dispatchOutbox(ctx.db, { [type]: [kindA, kindB] });
    await dispatchOutbox(ctx.db, { [type]: [kindA, kindB] });
    const a = await jobsOfKind(kindA);
    expect(a).toHaveLength(1);
    expect(a[0]?.dedupe_key).toBe(`${kindA}:${eventId}`);
    expect(a[0]?.payload).toMatchObject({ event_id: eventId, state: 'ready' });
    expect(await jobsOfKind(kindB)).toHaveLength(1);
  });
});
