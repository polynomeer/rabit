import type { KyselyPlugin } from 'kysely';
import type { Harness } from './harness.js';

/** Counts the SQL statements issued through `h.ctx.db` while `fn` runs (review #6 tests). */
export async function countQueries(h: Harness, fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const counter: KyselyPlugin = {
    transformQuery: (a) => {
      n++;
      return a.node;
    },
    transformResult: (a) => Promise.resolve(a.result),
  };
  const ctx = h.ctx as { db: typeof h.ctx.db };
  const original = ctx.db;
  ctx.db = original.withPlugin(counter);
  try {
    await fn();
  } finally {
    ctx.db = original;
  }
  return n;
}
