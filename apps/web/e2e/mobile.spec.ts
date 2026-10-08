import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor } from './support.ts';

test.use({ viewport: { width: 375, height: 812 } });

test('every tab fits a 375 px screen without horizontal scrolling', async ({ page }) => {
  const subject = subjectFor('mobile');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  for (const tab of ['Home', 'Search', 'DIG', 'Archive', 'Studio', 'Playlists', 'Account']) {
    await openTab(page, tab);
    await expect(
      page.getByRole('heading', { level: 2 }).or(page.locator('main p')).first(),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${tab} scrolls horizontally`).toBeLessThanOrEqual(0);
  }
});
