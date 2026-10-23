import { expect, test } from '@playwright/test';
import { provision, signIn, subjectFor } from './support.ts';

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
