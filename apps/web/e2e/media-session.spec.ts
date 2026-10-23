import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/** The lock screen and media keys (Media Session API) follow the player. */
test('media keys and the lock screen show and control the current track', async ({ page }) => {
  const subject = subjectFor('media-session');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);
  const meta = () =>
    page.evaluate(() => ({
      title: navigator.mediaSession.metadata?.title,
      artist: navigator.mediaSession.metadata?.artist,
      state: navigator.mediaSession.playbackState,
    }));
  await expect.poll(meta).toEqual({
    title: 'Midnight Harbour',
    artist: 'Velvet Quasar',
    state: 'playing',
  });

  // The pause key pauses the player (the handler the browser would call).
  await page.getByRole('button', { name: '일시정지' }).first().click();
  await expect.poll(async () => (await meta()).state).toBe('paused');
});
