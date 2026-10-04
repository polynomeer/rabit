/**
 * Latency of one shared rate-limit counter update (ADR-0020): sequential and
 * with concurrent callers on distinct keys. Usage: pnpm exec tsx bench/rate-limit-store.ts
 */
import { performance } from 'node:perf_hooks';
import { createDb } from '../src/platform/db/db.js';
import { postgresRateLimitStore } from '../src/platform/http/rate-limit-store.js';

const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgres://rabit:rabit@127.0.0.1:55440/rabit_test',
  32,
);
const Store = postgresRateLimitStore(db, (err) => {
  throw err;
});
const store = new Store({});
const incr = (key: string) =>
  new Promise<void>((resolve, reject) => {
    store.incr(
      key,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
      60_000,
      1_000_000,
    );
  });
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]?.toFixed(2);

const run = async (label: string, callers: number, perCaller: number) => {
  const times: number[] = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: callers }, async (_, c) => {
      for (let i = 0; i < perCaller; i++) {
        const t = performance.now();
        await incr(`bench:${label}:${String(c)}`);
        times.push(performance.now() - t);
      }
    }),
  );
  const secs = (performance.now() - started) / 1000;
  process.stdout.write(
    `${label}: ${String(times.length)} updates, p50 ${String(pct(times, 0.5))} ms, p99 ${String(pct(times, 0.99))} ms, ${(times.length / secs).toFixed(0)}/s\n`,
  );
};

await run('warmup', 4, 100);
await run('sequential', 1, 2000);
await run('concurrent-32', 32, 200);
await db.deleteFrom('rate_limit_counter').where('key', 'like', 'bench:%').execute();
await db.destroy();
