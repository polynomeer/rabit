import { expect, test } from '@playwright/test';
import { provision, signIn, subjectFor } from './support.ts';

/** Home shelves: new releases, albums on sale and a crate per decade. */
test('the home screen shows new releases and a crate per decade', async ({ page }) => {
  const subject = subjectFor('home-shelves');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await page.goto('/#/home');

  const fresh = page.getByRole('list', { name: '새로 나온 앨범' });
  await expect(fresh).toBeVisible();
  // Newest first: Paper Sky (2025) before Harbour Lights (2024).
  await expect(fresh.getByRole('link').first()).toContainText('Paper Sky');
  await expect(fresh).toContainText('Harbour Lights');
  await expect(page.getByRole('heading', { level: 3, name: '판매 중' })).toBeVisible();

  const decades = page.getByRole('group', { name: '연대별로 둘러보기' });
  await expect(decades.getByRole('button', { name: '2020년대' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('list', { name: '2020년대 앨범' })).toContainText('Harbour Lights');
  await decades.getByRole('button', { name: '1970년대' }).click();
  await expect(
    page.getByText('이 연대에서 지금 재생할 수 있는 앨범이 없어요.', { exact: false }),
  ).toBeVisible();

  // A cover opens the release.
  await fresh.getByRole('link', { name: /Harbour Lights/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Harbour Lights' })).toBeVisible();
});
