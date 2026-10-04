import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';
import * as m0001 from './migrations/0001_platform.js';

// Migrations operate on the raw schema, independent of the current table types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

/**
 * Static migration list (no filesystem discovery) so the same code runs from
 * TypeScript sources and from the compiled build. Order is by key.
 */
export const migrations: Record<string, Migration> = {
  '0001_platform': m0001,
};

export function createMigrator(db: AnyDb): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
}

function assertOk(result: MigrationResultSet): void {
  if (result.error) {
    const failed = result.results?.find((r) => r.status === 'Error');
    throw new Error(
      `Migration ${failed?.migrationName ?? '(unknown)'} failed: ${result.error instanceof Error ? result.error.message : JSON.stringify(result.error)}`,
    );
  }
}

export async function migrateToLatest(db: AnyDb): Promise<string[]> {
  const result = await createMigrator(db).migrateToLatest();
  assertOk(result);
  return (result.results ?? []).map((r) => r.migrationName);
}

export async function migrateDownOne(db: AnyDb): Promise<string[]> {
  const result = await createMigrator(db).migrateDown();
  assertOk(result);
  return (result.results ?? []).map((r) => r.migrationName);
}

export async function migrateDownAll(db: AnyDb): Promise<void> {
  const migrator = createMigrator(db);
  for (;;) {
    const result = await migrator.migrateDown();
    assertOk(result);
    if (!result.results || result.results.length === 0) return;
  }
}
