import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor } from './support.ts';

/** Crate Digging, private (DIG-009): a crate of playable albums from an era. */
test('digs a crate of playable albums from a decade', async ({ page }) => {
  const subject = subjectFor('crate');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await openTab(page, 'DIG');

  const panel = page.getByRole('region', { name: 'Crate Digging' });
  await panel.getByLabel('시대').selectOption('2020');
  await panel.getByRole('button', { name: '상자 뒤지기' }).click();
  const crate = panel.getByRole('list', { name: '상자 속 앨범' });
  await expect(crate.getByRole('link', { name: 'Harbour Lights' })).toBeVisible();
  await expect(crate.getByRole('link', { name: 'Paper Sky' })).toBeVisible();
  await expect(crate.getByRole('listitem').filter({ hasText: 'Harbour Lights' })).toContainText(
    '들을 수 있는 곡 2개',
  );

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // No album of the demo catalog is from the 1990s.
  await panel.getByLabel('시대').selectOption('1990');
  await panel.getByRole('button', { name: '다시 뒤지기' }).click();
  await expect(panel.getByRole('status')).toHaveText(/조건에 맞는 앨범이 없습니다/);

  await panel.getByLabel('시대').selectOption('2020');
  await panel.getByRole('button', { name: '다시 뒤지기' }).click();
  await crate.getByRole('link', { name: 'Paper Sky' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Paper Sky' })).toBeVisible();
});
