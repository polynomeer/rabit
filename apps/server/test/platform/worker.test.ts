import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createContext } from '../../src/app/context.js';
import { allModules } from '../../src/app/registry.js';
import { buildWorker } from '../../src/app/worker.js';
import { loadConfig } from '../../src/platform/config.js';
import { ulid } from '../../src/platform/ids.js';
import { createLogger } from '../../src/platform/logger.js';
import { testContext } from '../helpers/context.js';

const admin = testContext();
afterAll(() => admin.db.destroy());

describe('worker process', () => {
  it('keeps running when housekeeping fails (game day R17)', async () => {
    // A database without the schema: every housekeeping step fails.
    const name = `rabit_worker_${ulid().toLowerCase()}`;
    await sql.raw(`CREATE DATABASE ${name}`).execute(admin.db);
    const config = loadConfig();
    const url = new URL(config.db.url);
    url.pathname = `/${name}`;
    const log = createLogger({ level: 'silent', name: 'test' });
    const error = vi.spyOn(log, 'error');
    const ctx = createContext({ ...config, db: { ...config.db, url: url.toString() } }, log);
    const worker = buildWorker(ctx, allModules());
    try {
      worker.start();
      await vi.waitFor(() => {
        const steps = error.mock.calls
          .filter((c) => c[1] === 'worker housekeeping step failed')
          .map((c) => (c[0] as { step: string }).step);
        expect(steps).toEqual(
          expect.arrayContaining([
            'reclaim leases',
            'enqueue schedules',
            'purge rate-limit counters',
          ]),
        );
      });
    } finally {
      await worker.stop();
      await ctx.db.destroy();
      await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin.db);
    }
  });
});
