import { AxeBuilder } from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, expectPlaying, openTab, provision, subjectFor, wavTone } from './support.ts';

/** Accessibility rules (NFR-A11Y). Every screen of the reference client is scanned. */
// WCAG 2.1 A/AA plus axe's best practices (heading structure, landmarks).
const TAGS = (process.env['A11Y_TAGS'] ?? 'wcag2a,wcag2aa,wcag21a,wcag21aa,best-practice').split(
  ',',
);

async function scan(page: Page, screen: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = result.violations.map((v) => ({
    screen,
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  return found;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every screen passes WCAG 2.1 AA and best-practice checks (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    test.setTimeout(180_000);
    const subject = subjectFor('a11y');
    await provision(subject, { listener: true });
    const found = [];

    await page.goto('/');
    found.push(...(await scan(page, 'sign-in')));
    await page.getByLabel('개발용 로그인 ID').fill(subject);
    await page.getByLabel(/운영자/).check();
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '둘러보기' })).toBeVisible();
    found.push(...(await scan(page, 'home')));

    // Studio's upload form, then the Archive with the Audio Log and its editor open.
    await openTab(page, 'Studio');
    found.push(...(await scan(page, 'studio')));
    const upload = page.getByRole('form', { name: '오디오 업로드' });
    await upload.getByLabel('Audio Log').check();
    await upload.getByLabel('제목').fill('A11y memo');
    await upload
      .getByLabel('오디오 파일')
      .setInputFiles({ name: 'a.wav', mimeType: 'audio/wav', buffer: wavTone(2) });
    await upload.getByRole('button', { name: '업로드', exact: true }).click();
    await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
    await openTab(page, 'Archive');
    const item = page.getByRole('region', { name: 'Archive' }).getByRole('listitem').filter({
      hasText: 'A11y memo',
    });
    await item.getByRole('button', { name: '편집' }).click();
    found.push(...(await scan(page, 'archive')));

    await openTab(page, 'Search');
    await page.getByLabel('검색어').fill('Harbour');
    await page.getByRole('button', { name: '검색' }).click();
    await expect(page.getByRole('link', { name: 'Midnight Harbour' }).first()).toBeVisible();
    found.push(...(await scan(page, 'search')));

    await page.getByRole('link', { name: 'Midnight Harbour' }).first().click();
    await expect(page.getByRole('region', { name: 'Music Passport' })).toBeVisible();
    await page.getByRole('button', { name: /신고하기/ }).click();
    found.push(...(await scan(page, 'recording')));

    await page.getByRole('link', { name: 'Harbour Lights' }).first().click();
    await expect(page.getByRole('list', { name: '트랙' })).toBeVisible();
    found.push(...(await scan(page, 'release')));
    await page.getByRole('button', { name: '전체 재생' }).click();
    await page.getByRole('link', { name: /재생 화면 열기/ }).click();
    await expect(page.getByRole('slider', { name: '재생 위치' })).toBeVisible();
    found.push(...(await scan(page, 'now-playing')));
    await page.goBack();
    // Wait for the album again: until it loads, the mini player is the only artist link.
    await expect(page.getByRole('list', { name: '트랙' })).toBeVisible();

    await page.getByRole('link', { name: 'Velvet Quasar' }).first().click();
    await expect(page.getByRole('list', { name: '연결' }).getByRole('link').first()).toBeVisible();
    found.push(...(await scan(page, 'entity')));

    await page.getByRole('link', { name: '여기서 DIG 시작' }).click();
    await expect(page).toHaveURL(/dig-session/);
    await expect(page.getByRole('tablist', { name: '탐험 축' })).toBeVisible();
    found.push(...(await scan(page, 'dig-session')));
    await openTab(page, 'DIG');
    await expect(page.getByRole('list', { name: '내 DIG 기록' })).toBeVisible();
    found.push(...(await scan(page, 'dig-home')));

    await openTab(page, 'Playlists');
    await page.getByLabel('플레이리스트 이름').fill('A11y list');
    await page.getByRole('button', { name: '만들기' }).click();
    await page.getByRole('button', { name: 'A11y list' }).click();
    found.push(...(await scan(page, 'playlists')));

    await openTab(page, 'Account');
    await expect(page.getByRole('region', { name: '구독과 이용권' })).toBeVisible();
    found.push(...(await scan(page, 'account')));

    const me = (await apiAs(subject, 'GET', '/v1/me')).json as { user_id: string };
    await page.goto('/#/ops/users');
    await page.getByLabel(/처리 사유/).fill('a11y check');
    await page.getByLabel('사용자 ID').fill(me.user_id);
    await page.getByRole('button', { name: '지원 요약 조회' }).click();
    await expect(page.getByRole('region', { name: '요약: account' })).toBeVisible();
    found.push(...(await scan(page, 'ops-users')));
    for (const section of ['reports', 'jobs', 'rights']) {
      await page.goto(`/#/ops/${section}`);
      await expect(page.getByRole('heading', { level: 2, name: '운영' })).toBeVisible();
      found.push(...(await scan(page, `ops-${section}`)));
    }

    // Findings also land in a file, for CI artifacts and for reports on other rule sets.
    writeFileSync(
      test.info().outputPath(`a11y-${colorScheme}.json`),
      JSON.stringify(found, null, 1),
    );
    expect(found, JSON.stringify(found, null, 1)).toEqual([]);
  });
}

test('the core flow works with the keyboard alone', async ({ page }) => {
  const subject = subjectFor('keyboard');
  await provision(subject, { listener: true });
  await page.goto('/');
  // Sign in: focus the field, type, submit with Enter.
  await page.getByLabel('개발용 로그인 ID').focus();
  await page.keyboard.type(subject);
  await page.keyboard.press('Enter');
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  await expect(menu).toBeVisible();
  // Reach "Search" in the menu with Tab, open it with Enter.
  const search = menu.getByRole('button', { name: 'Search' });
  for (let i = 0; i < 10 && !(await search.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('검색어').focus();
  await page.keyboard.type('Midnight Harbour');
  await page.keyboard.press('Enter');
  // Follow the title link and play from the detail page, all by keyboard.
  const link = page.getByRole('link', { name: 'Midnight Harbour' }).first();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Midnight Harbour' })).toBeVisible();
  const play = page.getByRole('button', { name: '재생', exact: true });
  await play.focus();
  // Focus is visible (NFR-A11Y): the focus ring is drawn, not removed.
  expect(await play.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expectPlaying(page);
});
