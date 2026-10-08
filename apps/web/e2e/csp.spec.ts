import { expect, test } from '@playwright/test';
import { E2E } from './config.ts';
import { expectPlaying, openTab, provision, subjectFor, wavTone } from './support.ts';

/**
 * The production build under the production Content-Security-Policy
 * (infra/web/csp.json, sent by CloudFront): the core flows must work and the
 * browser must report no violation.
 */
test('the core flows run under the production Content-Security-Policy', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const subject = subjectFor('csp');
  await provision(subject, { listener: true });

  const res = await page.goto(E2E.cspWebUrl);
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-inline');

  await page.getByLabel('개발용 로그인 ID').fill(subject);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();

  // Upload straight to object storage with a presigned PUT.
  const name = `e2e-csp-${Date.now().toString(36)}`;
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wavTone(2) });
  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  await openTab(page, 'Archive');
  await expect(page.getByRole('region', { name: 'Archive' }).getByText(name)).toBeVisible();

  // Search and play catalog audio through the media gateway (hls.js, workers, blobs).
  await openTab(page, 'Search');
  await page.getByLabel('검색어').fill('Midnight Harbour');
  await page.getByRole('button', { name: '검색' }).click();
  const hit = page.getByRole('listitem').filter({ hasText: 'Midnight Harbour' }).first();
  await hit.getByRole('button', { name: '재생' }).click();
  await expectPlaying(page);

  await openTab(page, 'DIG');
  await openTab(page, 'Account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

  const violations = await page.evaluate(
    () => (window as unknown as { cspViolations: string[] }).cspViolations,
  );
  expect(violations).toEqual([]);
});
