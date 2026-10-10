import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, openTab, provision, signIn, subjectFor } from './support.ts';

const DEMO_TITLES = /Midnight Harbour|Morning Tide|Paper Lantern|Slow Orbit|Ember/;

/** Blind Digging (DIG-010): hear first, decide, then see what it was. */
test('plays a track with its identity hidden, then reveals it after Keep or Pass', async ({
  page,
}) => {
  const subject = subjectFor('blind');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await openTab(page, 'DIG');

  const blind = page.getByRole('region', { name: 'Blind Digging' });
  await blind.getByLabel('인지도').selectOption('any');
  await blind.getByRole('button', { name: '블라인드 라운드 시작' }).click();
  const current = blind.getByRole('group', { name: '지금 듣는 곡' });
  await expect(current).toContainText('번째');

  await current.getByRole('button', { name: '재생' }).click();
  await expectPlaying(page);
  // Neither the panel nor the player shows what is playing.
  const player = page.getByRole('contentinfo', { name: '플레이어' });
  await expect(player).toContainText('블라인드 곡');
  await expect(player).not.toContainText(DEMO_TITLES);
  await expect(blind).not.toContainText(DEMO_TITLES);

  await current.getByRole('button', { name: 'Keep' }).click();
  const revealed = blind.getByRole('list', { name: '공개된 곡' });
  await expect(revealed.getByRole('listitem')).toHaveCount(1);
  await expect(revealed.getByRole('listitem').first()).toContainText(DEMO_TITLES);
  const keptTitle = (await revealed.getByRole('link').first().textContent()) ?? '';

  // Keep saved it to the library.
  const library = (await apiAs(subject, 'GET', '/v1/library')).json as {
    items: { title: string | null }[];
  };
  expect(library.items.map((i) => i.title)).toContain(keptTitle);

  if (await current.isVisible()) {
    await current.getByRole('button', { name: 'Pass' }).click();
    await expect(revealed.getByRole('listitem')).toHaveCount(2);
    await expect(revealed.getByRole('listitem').nth(1)).toContainText('Pass');
  }

  // The player still holds the blind entry: Now Playing shows no cover of the track and
  // no links to its DIG, credits or album page.
  await page.getByRole('link', { name: /재생 화면 열기/ }).click();
  const now = page.getByRole('region', { name: '블라인드 곡' });
  await expect(now).toBeVisible();
  await expect(now.getByRole('link')).toHaveCount(0);
});
