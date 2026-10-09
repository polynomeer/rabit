import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor } from './support.ts';

/** Search says when nothing matched, and saving shows the saved state. */
test('search explains an empty result and marks a saved item', async ({ page }) => {
  const subject = subjectFor('search');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await openTab(page, 'Search');

  await page.getByLabel('검색어').fill('zzqx-no-such-track');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByRole('status')).toContainText('맞는 결과가 없어요');

  await page.getByLabel('검색어').fill('Morning Tide');
  await page.getByRole('button', { name: '검색' }).click();
  const hit = page.getByRole('listitem').filter({ hasText: 'Morning Tide' }).first();
  await hit.getByRole('button', { name: '라이브러리에 저장' }).click();
  const saved = hit.getByRole('button', { name: '저장됨' });
  await expect(saved).toBeDisabled();
  await expect(saved).toHaveAttribute('aria-pressed', 'true');
  await expect(hit.getByRole('status')).toHaveText('라이브러리에 저장했습니다.');

  // Its own page knows it is saved before any click (GET /v1/library?ref_id=).
  await hit.getByRole('link', { name: 'Morning Tide' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Morning Tide' })).toBeVisible();
  await expect(page.getByRole('button', { name: '저장됨' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
