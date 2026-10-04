/** Ports and URLs of the isolated E2E stack (distinct from the dev servers). */
const pgBase = process.env['E2E_PG_URL'] ?? 'postgres://rabit:rabit@127.0.0.1:55440';

export const E2E = {
  apiPort: 18080,
  mediaPort: 18081,
  metricsPort: 19464,
  webPort: 15173,
  apiUrl: 'http://localhost:18080',
  mediaUrl: 'http://localhost:18081',
  webUrl: 'http://localhost:15173',
  /** Maintenance connection used only to recreate the E2E database. */
  adminDatabaseUrl: `${pgBase}/postgres`,
  databaseUrl: `${pgBase}/rabit_e2e`,
} as const;
