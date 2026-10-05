import { expect, test } from '@playwright/test';
import { apiAs, openTab, provision, signIn, subjectFor } from './support.ts';

test('DIG sessions survive a reload, keep marks, end, and reopen from history', async ({
  page,
}) => {
  const subject = subjectFor('digsession');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  // Start from a recording page; the URL becomes the session's own.
  await openTab(page, 'Search');
  await page.getByLabel('검색어').fill('Midnight Harbour');
  await page.getByRole('button', { name: '검색' }).click();
  await page.getByRole('link', { name: 'Midnight Harbour' }).first().click();
  await page.getByRole('link', { name: 'DIG', exact: true }).click();
  await expect(page).toHaveURL(/#\/dig-session\/dgs_/);
  const trail = page.getByRole('navigation', { name: 'Digging Trail' });
  await expect(trail.getByRole('button')).toHaveCount(1);

  // Follow one connection, then reload: same session, nothing new created.
  await page.getByRole('tab', { name: /이 곡을 샘플링/ }).click();
  await page
    .getByRole('list', { name: '연결' })
    .getByRole('listitem')
    .filter({ hasText: 'Ember (Harbour Flip)' })
    .getByRole('button', { name: '따라가기' })
    .click();
  await expect(trail.getByRole('button')).toHaveCount(2);
  await page.reload();
  await expect(trail.getByRole('button')).toHaveCount(2);
  const sessions = (await apiAs(subject, 'GET', '/v1/dig-sessions')).json as {
    items: unknown[];
  };
  expect(sessions.items).toHaveLength(1);

  // Save the current point: marked in the trail; the chosen axis stays.
  await page.getByRole('tab', { name: /같은 레이블/ }).click();
  await page.getByRole('button', { name: '이 지점 저장' }).click();
  await expect(page.getByRole('button', { name: '저장한 지점', exact: true })).toBeDisabled();
  await expect(trail.getByRole('button', { name: /Ember/ })).toContainText('★');
  await expect(page.getByRole('tab', { name: /같은 레이블/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Name it, keep it, end it: an ended session can no longer grow.
  await page.getByRole('textbox', { name: 'DIG 제목' }).fill('Sample chain');
  await page.getByRole('button', { name: '제목 저장' }).click();
  await page.getByLabel('기록에 보관').check();
  await page.getByRole('button', { name: '탐험 끝내기' }).click();
  await expect(page.getByText('끝난 탐험')).toBeVisible();
  await expect(page.getByRole('button', { name: '따라가기' })).toHaveCount(0);

  // History lists it, also under "kept only", and reopens it.
  await openTab(page, 'DIG');
  const history = page.getByRole('list', { name: '내 DIG 기록' });
  await page.getByLabel('보관한 탐험만').check();
  const entry = history.getByRole('listitem').filter({ hasText: 'Sample chain' });
  await expect(entry).toContainText('2개 지점');
  await expect(entry).toContainText('끝남');
  await entry.getByRole('link', { name: 'Sample chain' }).click();
  await expect(trail.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'DIG 제목' })).toHaveValue('Sample chain');
});

test('quick successive DIG actions never show an older session state', async ({ page }) => {
  const subject = subjectFor('digrace');
  await provision(subject, { listener: true });
  const found = (await apiAs(subject, 'GET', '/v1/search?q=Midnight Harbour')).json as {
    items: { id: string; kind: string }[];
  };
  const rec = found.items.find((i) => i.kind === 'recording')?.id;
  await signIn(page, subject);
  await page.goto(`/#/dig/${String(rec)}`);
  await expect(page).toHaveURL(/#\/dig-session\//);
  await page.getByRole('tab', { name: /이 곡을 샘플링/ }).click();
  const follow = page
    .getByRole('list', { name: '연결' })
    .getByRole('button', { name: '따라가기' })
    .first();
  await expect(follow).toBeVisible();
  // Force the worst order: the step reaches the server late, and the save — if sent
  // concurrently — answers with the state from before the step, after the step's answer.
  let stepAnswered: () => void = () => undefined;
  const stepDone = new Promise<void>((resolve) => {
    stepAnswered = resolve;
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/steps')) stepAnswered();
  });
  await page.route('**/steps', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await page.route('**/nodes/*/actions', async (route) => {
    const response = await route.fetch();
    await Promise.race([stepDone, new Promise((r) => setTimeout(r, 3000))]);
    await route.fulfill({ response });
  });
  // Second click right after the first, without waiting for its answer.
  await follow.click();
  await page.getByRole('button', { name: '이 지점 저장' }).click();
  const trail = page.getByRole('navigation', { name: 'Digging Trail' });
  await expect(trail.getByRole('button')).toHaveCount(2);
  await expect(trail.getByRole('button').first()).toContainText('★');
  await page.reload();
  await expect(trail.getByRole('button')).toHaveCount(2);
});
