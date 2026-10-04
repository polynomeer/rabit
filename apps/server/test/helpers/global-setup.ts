import './env.js';
import { loadConfig } from '../../src/platform/config.js';
import { createDb } from '../../src/platform/db/db.js';
import { migrateDownAll, migrateToLatest } from '../../src/platform/db/migrator.js';

/** Fresh schema for every test run: down all, then up (also exercises rollback). */
export default async function setup(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.db.url, 2);
  try {
    await migrateDownAll(db);
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
}
