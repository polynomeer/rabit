import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import { requireOperator } from '../../platform/http/principal.js';
import { parse } from '../../platform/http/validation.js';
import { VALIDATION_TIME_ZONE, type ValidationSection } from '../../platform/validation.js';
import { validationCohort, type CohortMember } from '../identity/index.js';

/** A rate over fewer people (or sessions) than this is withheld (ADR-0032). */
export const MIN_GROUP = 5;
/** Weekly retention is reported for the first eight weeks after sign-up. */
export const RETENTION_WEEKS = 8;
const MAX_SPAN_DAYS = 366;

export interface Rate {
  count: number | null;
  of: number;
  rate: number | null;
  suppressed: boolean;
}

/** `count` of `of`, withheld when `of` is too small to keep one person from showing. */
export function rate(count: number, of: number): Rate {
  if (of < MIN_GROUP) return { count: null, of, rate: null, suppressed: true };
  return { count, of, rate: Math.round((count / of) * 1000) / 1000, suppressed: false };
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Today's calendar day in Korea, `YYYY-MM-DD`. */
export function koreanToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VALIDATION_TIME_ZONE }).format(now);
}

/**
 * Week k covers days 7(k−1)..7k−1 after each person's sign-up day. Only people whose
 * week k is over by `today` count for it, so a week is never read half way.
 */
export function weeklyRetention(
  cohort: readonly CohortMember[],
  activeDays: ReadonlyMap<string, ReadonlySet<string>>,
  today: string,
  weeks = RETENTION_WEEKS,
): ({ week: number } & Rate)[] {
  const now = dayNumber(today);
  return Array.from({ length: weeks }, (_, i) => {
    const week = i + 1;
    let eligible = 0;
    let active = 0;
    for (const m of cohort) {
      const start = dayNumber(m.signupDay);
      if (now - start < 7 * week) continue;
      eligible += 1;
      const days = activeDays.get(m.userId);
      if (!days) continue;
      for (const d of days) {
        const offset = dayNumber(d) - start;
        if (offset >= 7 * (week - 1) && offset < 7 * week) {
          active += 1;
          break;
        }
      }
    }
    return { week, ...rate(active, eligible) };
  });
}

const query = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`.' })
  .refine((q) => dayNumber(q.to) - dayNumber(q.from) < MAX_SPAN_DAYS, {
    message: `A cohort spans at most ${MAX_SPAN_DAYS} days.`,
  });

/**
 * Alpha validation metrics (ADR-0032): gate C read over a sign-up cohort, aggregates
 * only. Operators see counts and rates, never a person; every view is audited.
 */
export function alphaMetricsRoutes(sections: () => ValidationSection[]) {
  return (app: FastifyInstance, ctx: AppContext): void => {
    app.get('/v1/ops/metrics/alpha', async (req) => {
      const op = requireOperator(req.principal);
      const q = parse(query, req.query);
      const cohort = await validationCohort(ctx.db, {
        from: q.from,
        to: q.to,
        operatorIssuer: ctx.config.auth.operator?.issuer,
      });
      const userIds = cohort.map((m) => m.userId);
      const activeDays = new Map<string, Set<string>>();
      const counts: Record<string, number> = {};
      for (const s of sections()) {
        for (const a of await s.activeDays(ctx.db, userIds)) {
          const days = activeDays.get(a.userId) ?? new Set<string>();
          days.add(a.day);
          activeDays.set(a.userId, days);
        }
        Object.assign(counts, s.counts ? await s.counts(ctx.db, userIds) : {});
      }
      const n = (key: string) => {
        const v = counts[key];
        if (v === undefined) throw errors.invalidState(`Validation count ${key} is missing.`);
        return v;
      };
      const people = cohort.length;
      await audit(ctx.db, {
        actorType: 'operator',
        actorId: op.userId,
        action: 'ops.alpha_metrics_viewed',
        subjectType: 'cohort',
        subjectId: `${q.from}..${q.to}`,
        correlationId: req.id,
        details: { from: q.from, to: q.to, people },
      });
      return {
        cohort: { from: q.from, to: q.to, people },
        time_zone: VALIDATION_TIME_ZONE,
        min_group: MIN_GROUP,
        generated_at: new Date().toISOString(),
        retention: weeklyRetention(cohort, activeDays, koreanToday()),
        mixed_library: {
          playlist_mixers: rate(n('playlist_mixers'), people),
          own_audio_players: rate(n('own_audio_players'), people),
        },
        digging: {
          diggers: rate(n('diggers'), people),
          kept_sessions: rate(n('kept_dig_sessions'), n('dig_sessions')),
        },
        collection: {
          collectors: rate(n('collectors'), people),
          collectors_20_plus: rate(n('collectors_20_plus'), people),
        },
      };
    });
  };
}
