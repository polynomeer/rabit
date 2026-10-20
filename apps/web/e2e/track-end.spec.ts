import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/**
 * A track that plays to its end moves on to the next one. With gapless edit lists
 * (ADR-0008) hls.js does not signal the end of the stream, so the player treats a
 * stall at the very end as the end.
 */
test('moves on to the next track when one plays to its end', async ({ page }) => {
  const subject = subjectFor('track-end');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');
  expect(release).toBeTruthy();

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);
  const audio = page.getByLabel('오디오 컨트롤');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(2);
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = a.duration - 1.5;
  });
  const tracks = page.getByRole('list', { name: '트랙' });
  await expect(tracks.locator('li.current')).toContainText('Morning Tide', { timeout: 15_000 });
  await expectPlaying(page);
});
