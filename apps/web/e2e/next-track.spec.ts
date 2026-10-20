import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/**
 * Near the end of a track the player opens the next track's session and warms its
 * first segments, so the next track starts from the cache without a new session
 * request (audio pipeline review, stage A).
 */
test('prepares the next track before the current one ends', async ({ page }) => {
  const subject = subjectFor('next-track');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');
  expect(release).toBeTruthy();

  const sessions: string[] = [];
  const segments: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/playback-sessions')) sessions.push(r.url());
    if (/\/media\/v1\/[^/]+\/(\w+\/)?seg_00000\.m4s$/.test(r.url())) segments.push(r.url());
  });

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);

  // Within 30 s of the end (the fixture tracks are shorter than that) the next
  // session is opened and its first segment warmed while this track plays.
  await expect.poll(() => sessions.length).toBe(2);
  await expect.poll(() => segments.length).toBeGreaterThanOrEqual(2);
  const audio = page.getByLabel('오디오 컨트롤');
  expect(await audio.evaluate((a: HTMLAudioElement) => a.ended)).toBe(false);
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = Math.max(0, a.duration - 1);
  });

  // The next track starts on the prepared session.
  const tracks = page.getByRole('list', { name: '트랙' });
  await expect(tracks.locator('li.current')).toContainText('Morning Tide', { timeout: 15_000 });
  await expectPlaying(page);
  expect(sessions).toHaveLength(2);
});
