import { closeContext, createContext } from '../app/context.js';
import { allModules } from '../app/registry.js';
import { buildWorker } from '../app/worker.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { startMetricsServer } from '../platform/metrics.js';
import { onShutdown } from './shutdown.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'worker' });
const ctx = createContext(config, log);
const worker = buildWorker(ctx, allModules());
const metricsServer = startMetricsServer(config.http.metricsPort + 1);

worker.start();
log.info({ concurrency: config.worker.concurrency }, 'worker started');

onShutdown(log, async () => {
  await worker.stop();
  metricsServer.close();
  await closeContext(ctx);
});
