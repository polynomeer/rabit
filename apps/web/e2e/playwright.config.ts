import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { E2E } from './config.ts';

const web = fileURLToPath(new URL('..', import.meta.url));

/**
 * Browser E2E tests against a real, isolated stack (api, worker, media, web,
 * Postgres `rabit_e2e`, MinIO). Requires `pnpm infra:up` and ffmpeg.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../e2e-results/artifacts',
  // One shared stack and database: run serially for determinism.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../e2e-results/report' }]]
    : 'list',
  use: {
    baseURL: E2E.webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The player starts audio after a click handler's async work.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/stack.ts',
    cwd: web,
    url: E2E.webUrl,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
