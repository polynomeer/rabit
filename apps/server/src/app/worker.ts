import { purgeRateLimitCounters } from '../platform/http/rate-limit-store.js';
import { dispatchOutbox } from '../platform/jobs/outbox.js';
import { queueHealth } from '../platform/jobs/health.js';
import { JobRunner, type JobHandler } from '../platform/jobs/runner.js';
import type { AppContext } from './context.js';
import { mergeSubscriptions, type Module } from './modules.js';
import { enqueueDueSchedules } from './scheduler.js';

export interface WorkerProcess {
  runner: JobRunner;
  /** Every job kind of every pool, for queue metrics. */
  kinds: string[];
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

/** The handlers a worker of `pool` runs (ADR-0005 amendment 2026-10-20). */
export function handlersForPool(
  handlers: JobHandler[],
  pool: AppContext['config']['worker']['pool'],
): JobHandler[] {
  if (pool === 'all') return handlers;
  return handlers.filter((h) => (h.pool ?? 'general') === pool);
}

/**
 * One CloudWatch Embedded Metric Format line: the media jobs waiting to run, which
 * the transcoder service scales on (infra/aws/autoscaling.tf).
 */
export function mediaBacklogEmf(namespace: string, ready: number, oldestSeconds: number) {
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [[]],
          Metrics: [
            { Name: 'MediaJobsReady', Unit: 'Count' },
            { Name: 'MediaJobOldestSeconds', Unit: 'Seconds' },
          ],
        },
      ],
    },
    MediaJobsReady: ready,
    MediaJobOldestSeconds: oldestSeconds,
  };
}

export function buildWorker(ctx: AppContext, modules: Module[]): WorkerProcess {
  const all = modules.flatMap((m) => m.jobs?.(ctx) ?? []);
  const pool = ctx.config.worker.pool;
  const handlers = handlersForPool(all, pool);
  const mediaKinds = all.filter((h) => h.pool === 'media').map((h) => h.kind);
  // The media pool only processes media; the outbox and schedules belong to the rest.
  const coordinates = pool !== 'media';
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
    const steps: [string, () => Promise<unknown>][] = [['reclaim leases', () => runner.reclaim()]];
    if (coordinates) {
      steps.push(
        ['enqueue schedules', () => enqueueDueSchedules(ctx.db, schedules)],
        ['purge rate-limit counters', () => purgeRateLimitCounters(ctx.db)],
      );
    }
    const namespace = ctx.config.worker.cloudwatchNamespace;
    if (coordinates && namespace) {
      steps.push([
        'report media backlog',
        async () => {
          const h = await queueHealth(ctx.db, mediaKinds);
          const media = mediaKinds.map((k) => h.byKind[k] ?? { ready: 0, oldestSeconds: 0 });
          const emf = mediaBacklogEmf(
            namespace,
            media.reduce((n, k) => n + k.ready, 0),
            Math.max(0, ...media.map((k) => k.oldestSeconds)),
          );
          // stdout is shipped to CloudWatch Logs, which turns EMF lines into metrics.
          process.stdout.write(`${JSON.stringify(emf)}\n`);
        },
      ]);
    }
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
    kinds: all.map((h) => h.kind),
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
      if (coordinates) dispatching = dispatchLoop();
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
