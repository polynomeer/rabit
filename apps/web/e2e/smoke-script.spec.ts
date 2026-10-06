import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { E2E } from './config.ts';

/**
 * The post-deploy checks (infra/aws/scripts/smoke.sh) against the stack's
 * production-like instances: the api that trusts only the OIDC provider and the
 * production build under the production CSP. HSTS and the CloudFront media checks
 * need the real edge and are skipped here.
 */
const script = fileURLToPath(new URL('../../../infra/aws/scripts/smoke.sh', import.meta.url));

function smoke(env: Record<string, string>) {
  const r = spawnSync('bash', [script], {
    env: { ...process.env, EXPECT_HSTS: 'false', ...env },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('post-deploy checks pass against a production-like api and web client', () => {
  const r = smoke({ API_URL: E2E.oidcApiUrl, APP_URL: E2E.cspWebUrl });
  expect(r.out).not.toContain('FAIL');
  expect(r.status, r.out).toBe(0);
  expect(r.out).toContain('PASS  no development token issuer');
});

test('post-deploy checks catch an api that still issues development tokens (T03)', () => {
  const r = smoke({ API_URL: E2E.apiUrl, APP_URL: E2E.cspWebUrl });
  expect(r.status).not.toBe(0);
  expect(r.out).toContain('FAIL  no development token issuer');
});
