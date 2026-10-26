import { expect, test, type Page } from '@playwright/test';
import { asOperator, provision, signIn, subjectFor } from './support.ts';

/**
 * Time Radio (ADR-0034): music out by a chosen date, through the account queue.
 * The core demo set has Harbour Lights (2024-03-01) and Paper Sky (2025-09-12).
 */
test('plays only what was out by the chosen date, then leaves Time Radio', async ({ page }) => {
  const flag = await asOperator('PUT', '/v1/ops/features/exploration_time_machine', {
    override: { enabled: true, rollout_percent: 100 },
    reason: 'e2e time radio',
  });
  expect(flag.status).toBe(200);
  try {
    await run(page);
  } finally {
    await asOperator('PUT', '/v1/ops/features/exploration_time_machine', {
      override: null,
      reason: 'e2e time radio done',
    });
  }
});

async function run(page: Page) {
  const subject = subjectFor('time-radio');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  await page.goto('/#/dig');
  await page.getByRole('link', { name: '타임머신으로 듣기' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '타임머신' })).toBeVisible();
  await page.getByLabel('날짜', { exact: true }).fill('2024-06-15');
  await expect(page.getByRole('definition').first()).not.toHaveText('');
  await page.getByRole('button', { name: /출발$/ }).click();

  await expect(page).toHaveURL(/#\/now$/);
  const banner = page.getByRole('region', { name: '타임머신' });
  await expect(banner).toContainText('까지 나온 음악');
  const queue = page.getByRole('region', { name: '재생목록' });
  await expect(queue).toContainText(/Midnight Harbour|Morning Tide/);
  // Paper Sky came out in September 2025: none of its tracks may be suggested.
  for (const later of ['Paper Lantern', 'Slow Orbit', 'Ember (Harbour Flip)'])
    await expect(queue).not.toContainText(later);

  await banner.getByRole('button', { name: '타임머신 끄기' }).click();
  await expect(banner).toBeHidden();
}
