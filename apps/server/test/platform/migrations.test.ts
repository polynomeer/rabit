import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '../../src/platform/audit.js';
import { migrateDownAll, migrateToLatest, migrations } from '../../src/platform/db/migrator.js';
import { createDb } from '../../src/platform/db/db.js';
import { loadConfig } from '../../src/platform/config.js';
import { ulid } from '../../src/platform/ids.js';
import { testContext } from '../helpers/context.js';

const ctx = testContext();
afterAll(() => ctx.db.destroy());

describe('migrations', () => {
  it('apply, roll back completely and re-apply on a scratch database', async () => {
    const name = `rabit_mig_${ulid().toLowerCase()}`;
    await sql.raw(`CREATE DATABASE ${name}`).execute(ctx.db);
    const url = new URL(loadConfig().db.url);
    url.pathname = `/${name}`;
    const scratch = createDb(url.toString(), 1);
    try {
      expect(await migrateToLatest(scratch)).toEqual(Object.keys(migrations));
      await migrateDownAll(scratch);
      const tables = await sql<{ n: number }>`
        select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name not like 'kysely_%'`.execute(scratch);
      expect(tables.rows[0]?.n).toBe(0);
      expect(await migrateToLatest(scratch)).toEqual(Object.keys(migrations));
    } finally {
      await scratch.destroy();
      await sql.raw(`DROP DATABASE ${name}`).execute(ctx.db);
    }
  });

  it('keeps the audit log append-only', async () => {
    const subject = `sub_${ulid()}`;
    await audit(ctx.db, {
      actorType: 'system',
      actorId: null,
      action: 'test',
      subjectType: 'x',
      subjectId: subject,
    });
    await expect(
      ctx.db
        .updateTable('audit_log')
        .set({ action: 'tampered' })
        .where('subject_id', '=', subject)
        .execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.db.deleteFrom('audit_log').where('subject_id', '=', subject).execute(),
    ).rejects.toThrow(/append-only/);
  });
});
