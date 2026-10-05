import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, openTab, provision, signIn, subjectFor } from './support.ts';

test('recording, release and artist pages with Music Passport and reports', async ({ page }) => {
  const subject = subjectFor('detail');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  // Search → recording page through the title link.
  await openTab(page, 'Search');
  await page.getByLabel('검색어').fill('Midnight Harbour');
  await page.getByRole('button', { name: '검색' }).click();
  await page.getByRole('link', { name: 'Midnight Harbour' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Midnight Harbour' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Velvet Quasar' }).first()).toBeVisible();

  // Passport: per stage, unknown when nothing was declared, basis always shown.
  const passport = page.getByRole('region', { name: 'Music Passport' });
  const composition = passport.getByRole('row', { name: /작곡/ });
  await expect(composition).toContainText('사람');
  await expect(composition).toContainText('유통사 확인');
  await expect(passport.getByRole('row', { name: /마스터링/ })).toContainText('알 수 없음');
  await expect(
    passport.getByRole('listitem').filter({ hasText: 'Marguerite Okonkwo' }),
  ).toContainText('검증된 사실');
  await expect(passport).toContainText('하나의 점수가 아니라 서로 독립된 축입니다.');

  // Reports go to triage.
  await page.getByRole('button', { name: /신고하기/ }).click();
  const form = page.getByRole('form', { name: '신고' });
  await form.getByLabel('사유').selectOption('wrong_credit');
  await form.getByLabel('설명 (선택)').fill('Producer is listed twice.');
  await form.getByRole('button', { name: '신고 보내기' }).click();
  await expect(page.getByRole('status').filter({ hasText: '신고가 접수되었습니다' })).toBeVisible();

  // Back returns to the same search results (the query is in the URL).
  await page.getByRole('button', { name: '← 뒤로' }).click();
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Midnight Harbour' }).first()).toBeVisible();

  // Release page: ordered tracks, play from any track.
  await page.getByRole('link', { name: 'Midnight Harbour' }).first().click();
  await page.getByRole('link', { name: 'Harbour Lights' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Harbour Lights' })).toBeVisible();
  const tracks = page.getByRole('list', { name: '트랙' }).getByRole('listitem');
  await expect(tracks).toHaveCount(2);
  await expect(tracks.nth(0)).toContainText('Midnight Harbour');
  await tracks.nth(1).getByRole('button', { name: '재생' }).click();
  await expect(page.getByRole('contentinfo', { name: '플레이어' })).toContainText('Morning Tide');
  await expectPlaying(page);

  // Artist page: connections along the DIG axes, each linking on.
  await page.getByRole('link', { name: 'Velvet Quasar' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Velvet Quasar' })).toBeVisible();
  await expect(
    page.getByRole('tablist', { name: '연결 축' }).getByRole('tab').first(),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: '연결' }).getByRole('link').first()).toBeVisible();
  // Playback continued across all of these pages.
  await expect(page.getByRole('contentinfo', { name: '플레이어' })).toContainText('Morning Tide');
});

test('detail pages open from a link and fit a 375 px screen', async ({ page }) => {
  const subject = subjectFor('deeplink');
  await provision(subject, { listener: true });
  const found = (await apiAs(subject, 'GET', '/v1/search?q=Ember')).json as {
    items: { id: string; title: string }[];
  };
  const ember = found.items.find((i) => i.title.startsWith('Ember'));
  expect(ember).toBeTruthy();

  await signIn(page, subject);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/#/recording/${String(ember?.id)}`);
  await expect(page.getByRole('heading', { level: 2, name: /Ember/ })).toBeVisible();
  // The AI-assisted mastering claim is shown per stage, not as a single label.
  await expect(
    page.getByRole('region', { name: 'Music Passport' }).getByRole('row', { name: /마스터링/ }),
  ).toContainText('AI 보조');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'recording page scrolls horizontally').toBeLessThanOrEqual(0);

  await page.goto('/#/recording/rec_00000000000000000000000000');
  await expect(page.getByRole('status')).toHaveText('찾을 수 없습니다.');
});
