import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { createDb, pingDb } from '../../src/platform/db/db.js';
import { loadConfig } from '../../src/platform/config.js';

describe('database pool', () => {
  it('survives the database dropping an idle connection (game day R17)', async () => {
    const url = loadConfig().db.url;
    const onIdleError = vi.fn();
    const db = createDb(url, 1, onIdleError);
    const admin = createDb(url, 1);
    try {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);
      // What a database restart does to every open connection.
      await sql`select pg_terminate_backend(${rows[0]!.pid})`.execute(admin);
      await vi.waitFor(() => {
        expect(onIdleError).toHaveBeenCalledOnce();
      });
      // The pool replaces the connection on the next query.
      await expect(pingDb(db)).resolves.toBeUndefined();
    } finally {
      await db.destroy();
      await admin.destroy();
    }
  });
});
