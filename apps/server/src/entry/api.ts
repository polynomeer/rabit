import { buildApiApp } from '../app/api.js';
import { closeContext, createContext } from '../app/context.js';
import { allModules } from '../app/registry.js';
import { resolvePrincipal } from '../modules/identity/index.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { startMetricsServer } from '../platform/metrics.js';
import { onShutdown } from './shutdown.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, name: 'api' });
const ctx = createContext(config, log);
const { app } = await buildApiApp(ctx, allModules(), (token) => resolvePrincipal(ctx.db, token));
const metricsServer = startMetricsServer(config.http.metricsPort);

await app.listen({ port: config.http.apiPort, host: '0.0.0.0' });

onShutdown(log, async () => {
  await app.close();
  metricsServer.close();
  await closeContext(ctx);
});
