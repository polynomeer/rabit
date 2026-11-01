import { expect, test } from '@playwright/test';
import { E2E } from './config.ts';
import { asOperator, provision, subjectFor } from './support.ts';

/**
 * The DIG map base (ADR-0038) under the production Content-Security-Policy: MapLibre,
 * its worker and the tile reader load from our origin, no request goes to a third
 * party, OSM attribution is always shown, and the page keeps its list when the map
 * cannot draw (no WebGL) or the tile file is missing (as in this stack).
 */
test('the map loads only from our origins and degrades to the list', async ({ page }) => {
  const flag = await asOperator('PUT', '/v1/ops/features/exploration_map', {
    override: { enabled: true, rollout_percent: 100 },
    reason: 'e2e map',
  });
  expect(flag.status).toBe(200);
  try {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { cspViolations: string[] }).cspViolations = seen;
      document.addEventListener('securitypolicyviolation', (e) => {
        seen.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    const origins = new Set<string>();
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http')) origins.add(url.origin);
    });
    const subject = subjectFor('map');
    await provision(subject, { listener: true });

    await page.goto(E2E.cspWebUrl);
    await page.getByLabel('개발용 로그인 ID').fill(subject);
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
    await page.goto(`${E2E.cspWebUrl}/#/dig`);
    await page.getByRole('link', { name: '음악 지도' }).click();

    await expect(page.getByRole('heading', { name: '음악 지도' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '목록으로 보기' })).toBeVisible();
    // Headless browsers may have no WebGL; either way the page says what happened.
    const status = page.getByRole('status').filter({ hasText: /지도/ });
    await expect(status).toHaveText(
      /브라우저에서는 지도를 그릴 수 없어요|지도 바탕을 불러오지 못했어요/,
    );
    if ((await page.locator('canvas.maplibregl-canvas').count()) > 0) {
      await expect(page.getByRole('region', { name: '음악 지도' })).toBeVisible();
      await expect(page.getByRole('link', { name: '© OpenStreetMap 기여자' })).toBeVisible();
      await expect(page.getByRole('button', { name: '확대' })).toBeVisible();
    }

    const allowed = new Set([new URL(E2E.cspWebUrl).origin, new URL(E2E.apiUrl).origin]);
    expect([...origins].filter((o) => !allowed.has(o))).toEqual([]);
    const violations = await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    );
    expect(violations).toEqual([]);
  } finally {
    await asOperator('PUT', '/v1/ops/features/exploration_map', {
      override: null,
      reason: 'e2e map done',
    });
  }
});
