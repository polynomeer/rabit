import { closeContext, createContext } from '../app/context.js';
import { buildMediaApp } from '../app/media.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { startMetricsServer } from '../platform/metrics.js';
import { onShutdown } from './shutdown.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'media' });
const ctx = createContext(config, log);
const app = await buildMediaApp(ctx);
const metricsServer = startMetricsServer(config.http.metricsPort + 2);

await app.listen({ port: config.http.mediaPort, host: '0.0.0.0' });

onShutdown(log, async () => {
  await app.close();
  metricsServer.close();
  await closeContext(ctx);
});
