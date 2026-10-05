import { expect, test } from '@playwright/test';
import { expectPlaying, openTab, provision, signIn, subjectFor } from './support.ts';

test('search, play a licensed recording, and DIG without stopping playback', async ({ page }) => {
  const subject = subjectFor('dig');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  // Search → play (PB: catalog playback through the media gateway).
  await openTab(page, 'Search');
  await page.getByLabel('검색어').fill('Midnight Harbour');
  await page.getByRole('button', { name: '검색' }).click();
  const hit = page.getByRole('listitem').filter({ hasText: 'Midnight Harbour' }).first();
  await expect(hit).toBeVisible();

  const listened = page.waitForResponse(
    (r) => r.url().includes('/v1/listening-events/batch') && r.request().method() === 'POST',
  );
  await hit.getByRole('button', { name: '재생' }).click();
  const player = page.getByRole('contentinfo', { name: '플레이어' });
  await expect(player).toContainText('Midnight Harbour');
  const startedAt = await expectPlaying(page);
  expect((await listened).status()).toBe(202);

  // DIG from the playing recording: follow "sampled by" to the sampling track.
  await hit.getByRole('button', { name: 'DIG' }).click();
  await expect(page.getByRole('heading', { name: 'DIG' })).toBeVisible();
  const trail = page.getByRole('navigation', { name: 'Digging Trail' });
  await expect(trail.getByRole('button')).toHaveCount(1);
  await page.getByRole('tab', { name: /이 곡을 샘플링/ }).click();
  const connection = page
    .getByRole('list', { name: '연결' })
    .getByRole('listitem')
    .filter({ hasText: 'Ember (Harbour Flip)' });
  // Evidence is shown with the connection, not just the link.
  await expect(connection).toContainText('검증된 사실');
  // The reason is rendered from its code in the client's language.
  await expect(connection).toContainText('이 곡을 샘플링: Ember (Harbour Flip)');
  await connection.getByRole('button', { name: '따라가기' }).click();
  await expect(trail.getByRole('button')).toHaveCount(2);
  await expect(trail.getByRole('button', { name: /Ember \(Harbour Flip\)/ })).toHaveAttribute(
    'aria-current',
    'step',
  );

  // Exploring must not interrupt what is playing.
  await expect(player).toContainText('Midnight Harbour');
  await expect
    .poll(() => page.getByLabel('오디오 컨트롤').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(startedAt + 0.5);
  expect(await page.getByLabel('오디오 컨트롤').evaluate((a: HTMLAudioElement) => a.paused)).toBe(
    false,
  );

  // The trail becomes a playlist with both stops.
  await page.getByRole('button', { name: '트레일을 플레이리스트로' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '플레이리스트로 저장했습니다' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '플레이리스트 보기' }).click();
  const lists = page.getByRole('region', { name: 'Playlists' }).getByRole('listitem');
  await expect(lists.first()).toContainText('2곡');
  await lists.first().getByRole('button').click();
  const items = page.locator('.card ol > li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Midnight Harbour');
  await expect(items.nth(1)).toContainText('Ember (Harbour Flip)');
});
