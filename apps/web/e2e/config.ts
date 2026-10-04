/**
 * Ports and URLs of the isolated E2E stack (distinct from the dev servers).
 * Override with E2E_API_PORT / E2E_MEDIA_PORT / E2E_WEB_PORT / E2E_METRICS_PORT
 * when another program already uses a default port.
 */
const pgBase = process.env['E2E_PG_URL'] ?? 'postgres://rabit:rabit@127.0.0.1:55440';
const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const apiPort = port('E2E_API_PORT', 18080);
const mediaPort = port('E2E_MEDIA_PORT', 18081);
const webPort = port('E2E_WEB_PORT', 15173);

export const E2E = {
  apiPort,
  mediaPort,
  /** The worker and media roles use the next two ports. */
  metricsPort: port('E2E_METRICS_PORT', 19464),
  webPort,
  apiUrl: `http://localhost:${String(apiPort)}`,
  mediaUrl: `http://localhost:${String(mediaPort)}`,
  webUrl: `http://localhost:${String(webPort)}`,
  /** Maintenance connection used only to recreate the E2E database. */
  adminDatabaseUrl: `${pgBase}/postgres`,
  databaseUrl: `${pgBase}/rabit_e2e`,
} as const;
