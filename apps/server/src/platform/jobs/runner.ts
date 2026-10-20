import { hostname } from 'node:os';
import type { Logger } from 'pino';
import type { Db } from '../db/db.js';
import { ulid } from '../ids.js';
import { metrics } from '../metrics.js';
import {
  LEASE_WINDOW_MS,
  claimJobs,
  completeJob,
  extendLeases,
  failJob,
  reclaimExpiredLeases,
  releaseJobs,
  type ClaimedJob,
} from './queue.js';

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

export type JobPool = 'general' | 'media';

export interface JobHandler {
  kind: string;
  /**
   * Maximum runtime: the handler is aborted after this long. The claim itself is
   * short and renewed by a heartbeat while the job runs (LEASE_WINDOW_MS), so a
   * crashed worker's job is picked up again within that window.
   */
  leaseMs: number;
  /**
   * Worker pool that runs the job. `media` jobs (decoding, transcoding) run on their
   * own autoscaled service so a catalog backlog cannot delay payments or
   * revocations (ADR-0005 amendment 2026-10-20). Default `general`.
   */
  pool?: JobPool;
  /**
   * Claim order within a pool: lower runs first. Bulk work (catalog ingest) uses a
   * higher number so user uploads are not queued behind it. Default 0.
   */
  priority?: number;
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
  /** Claim window renewed by the heartbeat (tests shorten it). */
  leaseWindowMs?: number;
}

export class JobRunner {
  readonly workerId = `${hostname()}:${process.pid}:${ulid().slice(-6)}`;
  private readonly handlers: Map<string, JobHandler>;
  /** Handler kinds grouped by priority, lowest first. */
  private readonly tiers: string[][];
  private running = 0;
  private stopped = false;
  private wake: (() => void) | null = null;
  /** Jobs in flight, with the controller that aborts them. */
  private readonly active = new Map<string, AbortController>();
  /** Jobs handed back on shutdown: their late outcome must not be recorded. */
  private readonly released = new Set<string>();

  constructor(private readonly opts: RunnerOptions) {
    this.handlers = new Map(opts.handlers.map((h) => [h.kind, h]));
    const by = new Map<number, string[]>();
    for (const h of opts.handlers)
      by.set(h.priority ?? 0, [...(by.get(h.priority ?? 0) ?? []), h.kind]);
    this.tiers = [...by.entries()].sort(([a], [b]) => a - b).map(([, kinds]) => kinds);
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
    const heartbeat = setInterval(() => {
      this.heartbeat().catch((err: unknown) => {
        this.opts.log.error({ err }, 'job lease heartbeat failed');
      });
    }, this.window / 4);
    try {
      await this.loop(interval);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private get window(): number {
    return this.opts.leaseWindowMs ?? LEASE_WINDOW_MS;
  }

  /** Renews the claims of running jobs; a job whose claim was lost is aborted. */
  async heartbeat(): Promise<void> {
    const ids = [...this.active.keys()];
    if (ids.length === 0) return;
    const held = await extendLeases(this.opts.db, this.workerId, ids, this.window);
    for (const id of ids) {
      if (held.has(id)) continue;
      this.opts.log.warn({ job_id: id }, 'job lease lost; aborting (another worker may run it)');
      this.active.get(id)?.abort(new Error('job lease lost'));
    }
  }

  private async loop(interval: number): Promise<void> {
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
  }

  /**
   * Stops claiming, lets running jobs finish for up to `graceMs`, then hands the
   * rest back to the queue without counting the attempt and aborts them.
   */
  async shutdown(graceMs: number): Promise<number> {
    this.stop();
    const deadline = Date.now() + graceMs;
    while (this.running > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const left = [...this.active.keys()];
    if (left.length === 0) return 0;
    for (const id of left) this.released.add(id);
    const n = await releaseJobs(this.opts.db, this.workerId, left);
    for (const id of left) this.active.get(id)?.abort(new Error('worker shutting down'));
    this.opts.log.warn({ released: n }, 'released unfinished jobs on shutdown');
    return n;
  }

  /** Recovers expired leases and runs compensation for jobs that became dead. */
  async reclaim(): Promise<number> {
    const { requeued, dead } = await reclaimExpiredLeases(this.opts.db);
    for (const job of dead) {
      const handler = this.handlers.get(job.kind);
      const log = this.opts.log.child({ job_id: job.id, job_kind: job.kind });
      metrics.jobsTotal.inc({ kind: job.kind, outcome: 'dead' });
      log.error('job dead-lettered after its worker repeatedly lost the lease');
      if (!handler?.onDead) continue;
      const ac = new AbortController();
      try {
        await handler.onDead({ job, log, signal: ac.signal }, new Error('lease expired'));
      } catch (err) {
        log.error({ err }, 'onDead handler failed');
      }
    }
    return requeued + dead.length;
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  private async tick(limit: number, wait = true): Promise<number> {
    const jobs: ClaimedJob[] = [];
    for (const kinds of this.tiers) {
      if (jobs.length >= limit) break;
      jobs.push(
        ...(await claimJobs(this.opts.db, {
          workerId: this.workerId,
          kinds,
          limit: limit - jobs.length,
          leaseMs: this.window,
        })),
      );
    }
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
    this.active.set(job.id, ac);
    const timer = setTimeout(() => {
      ac.abort(new Error('job exceeded its maximum runtime'));
    }, handler.leaseMs);
    const started = performance.now();
    const ctx: JobContext = { job, log, signal: ac.signal };
    try {
      await handler.handle(ctx);
      await completeJob(this.opts.db, job.id, this.workerId);
      metrics.jobsTotal.inc({ kind: job.kind, outcome: 'succeeded' });
      log.info({ duration_ms: Math.round(performance.now() - started) }, 'job succeeded');
    } catch (err) {
      if (this.released.has(job.id)) {
        log.info('job released on shutdown; it runs again elsewhere');
        return;
      }
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
      this.active.delete(job.id);
      this.released.delete(job.id);
      this.running--;
    }
  }
}
