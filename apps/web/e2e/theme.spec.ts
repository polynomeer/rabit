import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor } from './support.ts';

const DARK_BG = 'rgb(14, 14, 16)';
const LIGHT_BG = 'rgb(244, 241, 236)';

/** Theme choice (ADR-0022): overrides the OS setting, per device, survives a reload. */
test('a chosen theme overrides the device setting and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const subject = subjectFor('theme');
  await provision(subject);
  await signIn(page, subject);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe(DARK_BG);

  await openTab(page, 'Account');
  const theme = page.getByRole('group', { name: '화면 테마' });
  await expect(theme.getByRole('radio', { name: '기기 설정' })).toBeChecked();
  await theme.getByRole('radio', { name: '라이트' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe(LIGHT_BG);

  await page.reload();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  expect(await bg()).toBe(LIGHT_BG);

  await openTab(page, 'Account');
  await page
    .getByRole('group', { name: '화면 테마' })
    .getByRole('radio', { name: '기기 설정' })
    .check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg()).toBe(DARK_BG);
});
