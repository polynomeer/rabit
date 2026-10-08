import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/** Album page → Now Playing: custom controls drive the media element (ADR-0022). */
test('plays an album, controls it from Now Playing and digs without stopping', async ({ page }) => {
  const subject = subjectFor('now-playing');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');
  expect(release).toBeTruthy();

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Harbour Lights' })).toBeVisible();
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);
  // The playing track is marked in the album's track list.
  const tracks = page.getByRole('list', { name: '트랙' });
  await expect(tracks.locator('li.current')).toContainText('Midnight Harbour');

  // The mini player opens the full player.
  await page.getByRole('link', { name: /재생 화면 열기/ }).click();
  await expect(page).toHaveURL(/#\/now$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Midnight Harbour' })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: '플레이어' })).toBeHidden();
  await expect(page.getByRole('slider', { name: '재생 위치' })).toBeEnabled();

  // Pause and resume through the custom controls.
  const audio = page.getByLabel('오디오 컨트롤');
  await page.getByRole('button', { name: '일시정지' }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.getByRole('button', { name: '이어서 재생' }).click();
  await expectPlaying(page);

  // Next track from the queue controls.
  await page.getByRole('button', { name: '다음 곡' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Morning Tide' })).toBeVisible();
  await expectPlaying(page);

  // DIG from here keeps the music playing.
  await page.getByRole('link', { name: 'Go deeper in music' }).click();
  await expect(page).toHaveURL(/dig-session/);
  await expect(page.getByRole('contentinfo', { name: '플레이어' })).toContainText('Morning Tide');
  expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
});
