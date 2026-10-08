import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';
import * as m0001 from './migrations/0001_platform.js';
import * as m0002 from './migrations/0002_identity.js';
import * as m0003 from './migrations/0003_audio.js';
import * as m0004 from './migrations/0004_playback.js';
import * as m0005 from './migrations/0005_audio_log.js';
import * as m0006 from './migrations/0006_catalog_entitlement.js';
import * as m0007 from './migrations/0007_library.js';
import * as m0008 from './migrations/0008_dig.js';
import * as m0009 from './migrations/0009_search.js';
import * as m0010 from './migrations/0010_integrity.js';
import * as m0011 from './migrations/0011_rate_limit.js';
import * as m0012 from './migrations/0012_physical_collection.js';
import * as m0013 from './migrations/0013_blind_dig.js';
import * as m0014 from './migrations/0014_commerce.js';
import * as m0015 from './migrations/0015_subscription_billing.js';

// Migrations operate on the raw schema, independent of the current table types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

/**
 * Static migration list (no filesystem discovery) so the same code runs from
 * TypeScript sources and from the compiled build. Order is by key.
 */
export const migrations: Record<string, Migration> = {
  '0001_platform': m0001,
  '0002_identity': m0002,
  '0003_audio': m0003,
  '0004_playback': m0004,
  '0005_audio_log': m0005,
  '0006_catalog_entitlement': m0006,
  '0007_library': m0007,
  '0008_dig': m0008,
  '0009_search': m0009,
  '0010_integrity': m0010,
  '0011_rate_limit': m0011,
  '0012_physical_collection': m0012,
  '0013_blind_dig': m0013,
  '0014_commerce': m0014,
  '0015_subscription_billing': m0015,
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
