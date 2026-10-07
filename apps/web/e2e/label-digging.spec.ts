import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAs, provision, signIn, subjectFor } from './support.ts';

/** Label Digging, basic (DIG-011): a label's releases on a time axis. */
test('a label page shows its releases by year and its artists', async ({ page }) => {
  const subject = subjectFor('label');
  await provision(subject);
  const r = (await apiAs(subject, 'GET', '/v1/search?q=Tidal%20Room%20Records')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const label = r.items.find((i) => i.kind === 'label');
  expect(label).toBeTruthy();

  await signIn(page, subject);
  await page.goto(`/#/entity/${String(label?.id)}`);
  const timeline = page.getByRole('region', { name: '레이블 타임라인' });
  const years = timeline.getByRole('list', { name: '연도별 발매작' });
  await expect(years.getByRole('listitem').filter({ hasText: '2024' }).first()).toContainText(
    'Harbour Lights',
  );
  await expect(years.getByRole('listitem').filter({ hasText: '2025' }).first()).toContainText(
    'Paper Sky',
  );
  const artists = timeline.getByRole('list', { name: '이 레이블의 아티스트' });
  await expect(artists.getByRole('listitem').filter({ hasText: 'Velvet Quasar' })).toContainText(
    '2024',
  );
  // The new section meets the same accessibility rules as every screen (a11y.spec).
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await timeline.getByRole('link', { name: 'Paper Sky' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Paper Sky' })).toBeVisible();
});
