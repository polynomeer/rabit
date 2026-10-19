import { closeContext, createContext } from '../app/context.js';
import { allModules } from '../app/registry.js';
import { buildWorker, SHUTDOWN_GRACE_MS } from '../app/worker.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { registerQueueMetrics, startMetricsServer } from '../platform/metrics.js';
import { queueHealth } from '../platform/jobs/health.js';
import { onShutdown } from './shutdown.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'worker' });
const ctx = createContext(config, log);
const worker = buildWorker(ctx, allModules());
registerQueueMetrics(() => queueHealth(ctx.db));
const metricsServer = startMetricsServer(config.http.metricsPort + 1);

worker.start();
log.info({ concurrency: config.worker.concurrency }, 'worker started');

// Jobs get SHUTDOWN_GRACE_MS, then are released; the process must still exit
// before ECS's stopTimeout (120 s) sends SIGKILL.
onShutdown(
  log,
  async () => {
    await worker.stop();
    metricsServer.close();
    await closeContext(ctx);
  },
  SHUTDOWN_GRACE_MS + 15_000,
);
