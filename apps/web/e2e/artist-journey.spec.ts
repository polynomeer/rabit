import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAs, asOperator, provision, signIn, subjectFor } from './support.ts';

/** Artist Journey (EX-02): releases by date, with the historical view behind a cutoff. */
test('an artist page opens the journey, and a cutoff hides later releases', async ({ page }) => {
  const subject = subjectFor('journey');
  await provision(subject);
  const flag = await asOperator('PUT', '/v1/ops/features/exploration_journey', {
    override: { enabled: true, rollout_percent: 100 },
    reason: 'e2e artist journey',
  });
  expect(flag.status).toBe(200);
  const r = (await apiAs(subject, 'GET', '/v1/search?q=Velvet%20Quasar')).json as {
    items: { id: string; kind: string }[];
  };
  const artist = r.items.find((i) => i.kind === 'artist');
  expect(artist).toBeTruthy();
  // The server caches flags for up to 15 s.
  await expect
    .poll(
      async () =>
        (await apiAs(subject, 'GET', `/v1/dig/artists/${String(artist?.id)}/journey`)).status,
      { timeout: 30_000 },
    )
    .toBe(200);

  await signIn(page, subject);
  await page.goto(`/#/entity/${String(artist?.id)}`);
  await page.getByRole('link', { name: '아티스트 여정' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Velvet Quasar' })).toBeVisible();
  const line = page.getByRole('list', { name: '연대기' });
  await expect(line.getByRole('listitem').filter({ hasText: 'Harbour Lights' })).toContainText(
    '2024',
  );

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Harbour Lights came out on 2024-03-01: a cutoff a day earlier hides it.
  await page.getByLabel('기준일').fill('2024-02-29');
  await page.getByRole('radio', { name: '기준일까지만' }).click();
  await expect(page.getByRole('note')).toContainText('그 뒤에 나온 작품 1개');
  await expect(page.getByText('이 기준으로 보여 줄 작품이 없어요.')).toBeVisible();
  await page.getByLabel('기준일').fill('2024-03-01');
  await expect(line.getByRole('listitem').filter({ hasText: 'Harbour Lights' })).toBeVisible();
});
