import { expect, test } from '@playwright/test';
import { asOperator, provision, signIn, subjectFor } from './support.ts';

/** Client diagnostics (ADR-0027): an uncaught error and the page load reach the API. */
test('an uncaught error is reported when the page is hidden', async ({ page }) => {
  const subject = subjectFor('diagnostics');
  await provision(subject);
  await signIn(page, subject);

  await page.evaluate(() => {
    setTimeout(() => {
      throw new TypeError('diagnostics probe');
    });
  });
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/v1/client-diagnostics') && r.request().method() === 'POST',
  );
  // Leaving the tab sends what is pending (with keepalive).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const res = await sent;
  expect(res.status()).toBe(204);
  const body = res.request().postDataJSON() as {
    platform: string;
    app_version: string;
    launches: number;
    errors: { kind: string; name: string; message: string; frames: string[] }[];
  };
  expect(body.platform).toBe('web');
  expect(body.launches).toBeGreaterThanOrEqual(1);
  expect(body.errors).toContainEqual(
    expect.objectContaining({ kind: 'unhandled', name: 'TypeError', message: 'diagnostics probe' }),
  );
  // Nothing in the batch names the listener.
  expect(JSON.stringify(body)).not.toContain(subject);
});

/** The kill switch (ADR-0028): with `client_diagnostics` off, nothing is sent. */
test('nothing is reported while the kill switch is off', async ({ page }) => {
  const off = await asOperator('PUT', '/v1/ops/features/client_diagnostics', {
    override: { enabled: false, rollout_percent: 0 },
    reason: 'e2e kill switch',
  });
  expect(off.status).toBe(200);
  try {
    const subject = subjectFor('diagnostics-off');
    await provision(subject);
    let sent = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/v1/client-diagnostics')) sent += 1;
    });
    // The override clears the API's flag cache, so the next read sees it off.
    const flags = page.waitForResponse((r) => r.url().endsWith('/v1/features'));
    await signIn(page, subject);
    expect(await (await flags).json()).toEqual({ features: { client_diagnostics: false } });
    await page.evaluate(() => {
      setTimeout(() => {
        throw new TypeError('should not be reported');
      });
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    expect(sent).toBe(0);
  } finally {
    await asOperator('PUT', '/v1/ops/features/client_diagnostics', {
      override: null,
      reason: 'e2e kill switch done',
    });
  }
});
