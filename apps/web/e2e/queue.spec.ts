import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/** The play queue (ADR-0026): history, chosen tracks and explained suggestions. */
test('the queue keeps history, explains suggestions and saves as a playlist', async ({ page }) => {
  const subject = subjectFor('queue');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);
  await page.getByRole('link', { name: /재생 화면 열기/ }).click();

  await expect(page.getByRole('list', { name: '지금 재생' })).toContainText('Midnight Harbour');
  await expect(page.getByRole('list', { name: '내가 고른 다음 곡' })).toContainText('Morning Tide');
  // Ember (Harbour Flip) samples Midnight Harbour (verified): the first suggestion says so.
  const suggested = page.getByRole('list', { name: '자동추천' });
  await expect(suggested.getByRole('listitem').first()).toContainText('Ember (Harbour Flip)');
  await expect(suggested.getByRole('listitem').first()).toContainText(
    '이 곡을 샘플링 · Lumen Avenue',
  );

  // Keeping a suggestion makes it the listener's choice.
  await suggested.getByRole('button', { name: 'Ember (Harbour Flip) 유지' }).click();
  await expect(page.getByRole('list', { name: '내가 고른 다음 곡' })).toContainText(
    'Ember (Harbour Flip)',
  );

  // Moving on keeps the first track as history; the queue survives a reload.
  await page.getByRole('button', { name: '다음 곡', exact: true }).first().click();
  await expect(page.getByRole('list', { name: '지금 재생' })).toContainText('Morning Tide');
  await page.reload();
  await expect(page.getByRole('list', { name: '지난 곡' })).toContainText('Midnight Harbour');

  // The chosen tracks become a playlist.
  await page.getByText('플레이리스트로 저장').click();
  await page.getByRole('button', { name: '내가 고른 곡만' }).click();
  await expect(page.getByRole('status')).toContainText('플레이리스트로 저장했어요');
  const playlists = (await apiAs(subject, 'GET', '/v1/playlists')).json as {
    items: { title: string; item_count: number }[];
  };
  expect(playlists.items.find((p) => p.title.startsWith('내가 고른 곡'))?.item_count).toBe(3);
});

test('Account switches 재생 방식 for the whole account', async ({ page }) => {
  const subject = subjectFor('queue-mode');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await page.goto('/#/account');
  await page.getByRole('radio', { name: /그 곡으로 자동추천 시작/ }).check();
  await expect
    .poll(async () => ((await apiAs(subject, 'GET', '/v1/queue')).json as { mode: string }).mode)
    .toBe('radio');
  await page.getByRole('checkbox', { name: /자동추천으로 이어 재생/ }).uncheck();
  await expect
    .poll(
      async () =>
        ((await apiAs(subject, 'GET', '/v1/queue')).json as { autoplay: boolean }).autoplay,
    )
    .toBe(false);
});

test('a track page queues the track next, at the end, or starts autoplay from it', async ({
  page,
}) => {
  const subject = subjectFor('queue-actions');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Midnight%20Harbour')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const track = search.items.find((i) => i.kind === 'recording' && i.title === 'Midnight Harbour');
  await signIn(page, subject);
  await page.goto(`/#/recording/${String(track?.id)}`);
  await page.getByRole('button', { name: '다음에 재생' }).click();
  await expect(page.getByRole('status').filter({ hasText: '다음 곡으로 넣었어요' })).toBeVisible();
  await page.getByRole('button', { name: '이 곡으로 자동추천' }).click();
  await expectPlaying(page);
  const queue = (await apiAs(subject, 'GET', '/v1/queue')).json as {
    items: { title: string; state: string; origin: string }[];
  };
  expect(queue.items.find((i) => i.state === 'current')?.title).toBe('Midnight Harbour');
});
