import type { FastifyInstance } from 'fastify';
import type { JobHandler } from '../platform/jobs/runner.js';
import type { Subscriptions } from '../platform/jobs/outbox.js';
import type { AppContext } from './context.js';

/** A bounded context's contribution to the process roles (ADR-0001). */
export interface Module {
  name: string;
  routes?(app: FastifyInstance, ctx: AppContext): void | Promise<void>;
  jobs?(ctx: AppContext): JobHandler[];
  /** Event type → job kinds handled by this module. */
  subscriptions?: Subscriptions;
  /** Periodic jobs: kind + interval; enqueued by the scheduler with a time-bucket dedupe key. */
  schedules?: { kind: string; everyMs: number }[];
}

export function mergeSubscriptions(modules: Module[]): Subscriptions {
  const out: Subscriptions = {};
  for (const m of modules) {
    for (const [event, kinds] of Object.entries(m.subscriptions ?? {})) {
      out[event] = [...(out[event] ?? []), ...kinds];
    }
  }
  return out;
}
