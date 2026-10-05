import { purgeRateLimitCounters } from '../platform/http/rate-limit-store.js';
import { dispatchOutbox } from '../platform/jobs/outbox.js';
import { JobRunner } from '../platform/jobs/runner.js';
import type { AppContext } from './context.js';
import { mergeSubscriptions, type Module } from './modules.js';
import { enqueueDueSchedules } from './scheduler.js';

export interface WorkerProcess {
  runner: JobRunner;
  /** One pass of dispatch + schedules + lease reclaim + jobs; used by tests. */
  drain(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export function buildWorker(ctx: AppContext, modules: Module[]): WorkerProcess {
  const handlers = modules.flatMap((m) => m.jobs?.(ctx) ?? []);
  const subscriptions = mergeSubscriptions(modules);
  const schedules = modules.flatMap((m) => m.schedules ?? []);
  const runner = new JobRunner({
    db: ctx.db,
    log: ctx.log,
    handlers,
    concurrency: ctx.config.worker.concurrency,
  });
  const timers: NodeJS.Timeout[] = [];
  let loop: Promise<void> | null = null;

  /** Each step runs and fails on its own: a failing purge must not stop lease reclaim. */
  const housekeeping = async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ['reclaim leases', () => runner.reclaim()],
      ['enqueue schedules', () => enqueueDueSchedules(ctx.db, schedules)],
      ['purge rate-limit counters', () => purgeRateLimitCounters(ctx.db)],
    ];
    for (const [step, fn] of steps) {
      try {
        await fn();
      } catch (err) {
        ctx.log.error({ err, step }, 'worker housekeeping step failed');
      }
    }
  };

  return {
    runner,
    async drain() {
      for (let i = 0; i < 20; i++) {
        const dispatched = await dispatchOutbox(ctx.db, subscriptions);
        const processed = await runner.drain();
        if (dispatched === 0 && processed === 0) return;
      }
    },
    start() {
      const every = (ms: number, fn: () => Promise<unknown>) => {
        timers.push(
          setInterval(() => {
            fn().catch((err: unknown) => {
              ctx.log.error({ err }, 'worker background task failed');
            });
          }, ms),
        );
      };
      every(250, () => dispatchOutbox(ctx.db, subscriptions));
      every(30_000, housekeeping);
      void housekeeping();
      loop = runner.run();
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      runner.stop();
      await loop;
    },
  };
}
