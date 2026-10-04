import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/**
 * A `@fastify/rate-limit` store whose counters live in Postgres, so every api
 * instance enforces the same limit (R13, ADR-0020). One statement increments
 * the counter, starts a new fixed window when the old one ended and returns
 * the remaining time, all on the database clock. `continueExceeding` and
 * exponential backoff are not supported (not used by Rabit).
 */
export function postgresRateLimitStore(
  db: Db,
  onError: (err: Error) => void,
): FastifyRateLimitStoreCtor {
  class PostgresStore implements FastifyRateLimitStore {
    constructor(private readonly prefix = 'rl:') {}

    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number,
    ): void {
      sql<{ count: number; ttl_ms: number }>`
        INSERT INTO rate_limit_counter AS c (key, count, window_ends_at)
        VALUES (${this.prefix + key}, 1, now() + make_interval(secs => ${timeWindow / 1000}))
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN c.window_ends_at <= now() THEN 1 ELSE c.count + 1 END,
          window_ends_at = CASE WHEN c.window_ends_at <= now()
                                THEN excluded.window_ends_at ELSE c.window_ends_at END
        RETURNING count,
                  GREATEST(0, ceil(extract(epoch FROM window_ends_at - now()) * 1000))::int AS ttl_ms`
        .execute(db)
        .then(
          (r) => {
            const row = r.rows[0];
            if (!row) callback(new Error('rate limit counter was not returned'));
            else callback(null, { current: row.count, ttl: row.ttl_ms });
          },
          (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            onError(error);
            callback(error);
          },
        );
    }

    /** Per-route limits count separately from the global one and from each other. */
    child(routeOptions: Parameters<FastifyRateLimitStore['child']>[0]): FastifyRateLimitStore {
      // At runtime the plugin passes `routeInfo` (as its own Redis store relies on);
      // the published typings declare plain route options instead.
      const info = (routeOptions as unknown as { routeInfo?: { method: string; url: string } })
        .routeInfo;
      const route = info
        ? `${info.method}${info.url}`
        : `${String(routeOptions.method)}${routeOptions.url}`;
      return new PostgresStore(`${this.prefix}${route}:`);
    }
  }
  return PostgresStore as unknown as FastifyRateLimitStoreCtor;
}

/** Removes counters whose window ended (worker housekeeping). */
export async function purgeRateLimitCounters(db: Db): Promise<number> {
  const res = await db
    .deleteFrom('rate_limit_counter')
    .where('window_ends_at', '<', sql<Date>`now() - interval '1 minute'`)
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}
