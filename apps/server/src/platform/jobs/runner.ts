import { hostname } from 'node:os';
import type { Logger } from 'pino';
import type { Db } from '../db/db.js';
import { ulid } from '../ids.js';
import { metrics } from '../metrics.js';
import { claimJobs, completeJob, failJob, type ClaimedJob } from './queue.js';

/** Thrown by handlers for failures that retrying cannot fix (e.g. unsupported media). */
export class PermanentJobError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PermanentJobError';
  }
}

export interface JobContext {
  job: ClaimedJob;
  log: Logger;
  signal: AbortSignal;
}

export interface JobHandler {
  kind: string;
  /** Lease must exceed the worst-case runtime; the handler is aborted at the lease end. */
  leaseMs: number;
  handle(ctx: JobContext): Promise<void>;
  /** Called once when the job goes to the DLQ, for compensating state changes. */
  onDead?(ctx: JobContext, error: unknown): Promise<void>;
}

export interface RunnerOptions {
  db: Db;
  log: Logger;
  handlers: JobHandler[];
  concurrency: number;
  pollIntervalMs?: number;
}

export class JobRunner {
  readonly workerId = `${hostname()}:${process.pid}:${ulid().slice(-6)}`;
  private readonly handlers: Map<string, JobHandler>;
  private running = 0;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(private readonly opts: RunnerOptions) {
    this.handlers = new Map(opts.handlers.map((h) => [h.kind, h]));
  }

  /** Processes ready jobs until none are left. Used by tests and by the loop. */
  async drain(maxRounds = 50): Promise<number> {
    let processed = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.tick(this.opts.concurrency);
      processed += n;
      if (n === 0) break;
    }
    return processed;
  }

  async run(): Promise<void> {
    const interval = this.opts.pollIntervalMs ?? 500;
    while (!this.stopped) {
      try {
        const free = this.opts.concurrency - this.running;
        const n = free > 0 ? await this.tick(free, false) : 0;
        if (n === 0) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
            setTimeout(resolve, interval);
          });
        }
      } catch (err) {
        this.opts.log.error({ err }, 'job loop error');
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    while (this.running > 0) await new Promise((r) => setTimeout(r, 50));
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  private async tick(limit: number, wait = true): Promise<number> {
    const kinds = [...this.handlers.keys()];
    const maxLease = Math.max(...[...this.handlers.values()].map((h) => h.leaseMs));
    const jobs = await claimJobs(this.opts.db, {
      workerId: this.workerId,
      kinds,
      limit,
      leaseMs: maxLease,
    });
    const runs = jobs.map((j) => this.execute(j));
    if (wait) await Promise.all(runs);
    else for (const r of runs) void r;
    return jobs.length;
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.kind);
    const log = this.opts.log.child({
      job_id: job.id,
      job_kind: job.kind,
      attempt: job.attempts,
      correlation_id: job.correlationId,
    });
    if (!handler) return;
    this.running++;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort(new Error('job lease expired'));
    }, handler.leaseMs);
    const started = performance.now();
    const ctx: JobContext = { job, log, signal: ac.signal };
    try {
      await handler.handle(ctx);
      await completeJob(this.opts.db, job.id, this.workerId);
      metrics.jobsTotal.inc({ kind: job.kind, outcome: 'succeeded' });
      log.info({ duration_ms: Math.round(performance.now() - started) }, 'job succeeded');
    } catch (err) {
      const permanent = err instanceof PermanentJobError;
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const outcome = await failJob(this.opts.db, job, this.workerId, message, { permanent });
      metrics.jobsTotal.inc({ kind: job.kind, outcome: outcome === 'dead' ? 'dead' : 'retry' });
      log.warn({ err, outcome, permanent }, 'job failed');
      if (outcome === 'dead' && handler.onDead) {
        try {
          await handler.onDead(ctx, err);
        } catch (deadErr) {
          log.error({ err: deadErr }, 'onDead handler failed');
        }
      }
    } finally {
      clearTimeout(timer);
      this.running--;
    }
  }
}
