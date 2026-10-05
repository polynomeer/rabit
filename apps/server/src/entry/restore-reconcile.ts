import { closeContext, createContext } from '../app/context.js';
import { reconcileAfterRestore } from '../modules/ops/restore-reconcile.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';

/**
 * Re-applies deletions after a database restore, before traffic is opened
 * (runbooks#backup-restore). Run the worker afterwards to finish the queued jobs.
 *   pnpm --filter @rabit/server restore:reconcile [--dry-run]
 */
const dryRun = process.argv.includes('--dry-run');
const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'restore-reconcile' });
const ctx = createContext(config, log);
try {
  const report = await reconcileAfterRestore(ctx, { dryRun });
  log.info(
    {
      dryRun,
      accountDeletionsRequeued: report.accountDeletionsRequeued,
      sourceDeletionsRequeued: report.sourceDeletionsRequeued,
      orphanedSources: report.orphanedSources.length,
      accountsToReview: report.accountsToReview,
    },
    'restore reconciliation finished',
  );
} catch (err) {
  log.error({ err }, 'restore reconciliation failed');
  process.exitCode = 1;
} finally {
  await closeContext(ctx);
}
