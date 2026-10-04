import { loadConfig } from '../platform/config.js';
import { createDb } from '../platform/db/db.js';
import { migrateDownOne, migrateToLatest } from '../platform/db/migrator.js';
import { createLogger } from '../platform/logger.js';

const direction = process.argv[2] ?? 'up';
const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'migrate' });
const db = createDb(config.db.url, 1);

try {
  if (direction === 'up') {
    const applied = await migrateToLatest(db);
    log.info({ applied }, 'migrations applied');
  } else if (direction === 'down') {
    const reverted = await migrateDownOne(db);
    log.info({ reverted }, 'migration reverted');
  } else {
    throw new Error(`unknown direction: ${direction}`);
  }
} catch (err) {
  log.error({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
