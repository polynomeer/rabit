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
  /**
   * Stops claiming and dispatching; running jobs get `graceMs` to finish, then
   * are handed back to the queue (ECS gives the task `stopTimeout` after SIGTERM).
   */
  stop(graceMs?: number): Promise<void>;
}

/** Time running jobs get to finish on shutdown, inside ECS's 120 s stopTimeout. */
export const SHUTDOWN_GRACE_MS = 90_000;

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
  let dispatching: Promise<void> | null = null;
  let stopped = false;

  /** One dispatch at a time: the next pass starts only after the previous one ended. */
  const dispatchLoop = async () => {
    while (!stopped) {
      let moved = 0;
      try {
        moved = await dispatchOutbox(ctx.db, subscriptions);
      } catch (err) {
        ctx.log.error({ err }, 'outbox dispatch failed');
      }
      if (moved === 0) await new Promise((r) => setTimeout(r, 250));
    }
  };

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
      dispatching = dispatchLoop();
      every(30_000, housekeeping);
      void housekeeping();
      loop = runner.run();
    },
    async stop(graceMs = SHUTDOWN_GRACE_MS) {
      stopped = true;
      for (const t of timers) clearInterval(t);
      await runner.shutdown(graceMs);
      await Promise.all([loop, dispatching]);
    },
  };
}
