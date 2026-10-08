import { expect, test } from '@playwright/test';
import { asOperator, openTab, provision, signIn, subjectFor } from './support.ts';

/**
 * Monthly subscription with the sandbox provider (COM-008, provisional price):
 * subscribe from the Account page, then stop renewal without losing the month.
 */
test('subscribes with the mock provider and stops renewal', async ({ page }) => {
  const subject = subjectFor('subscriber');
  const userId = await provision(subject);
  await asOperator('PUT', `/v1/ops/users/${userId}/license-country`, {
    license_country: 'KR',
    reason: 'e2e setup',
  });

  await signIn(page, subject);
  await openTab(page, 'Account');
  const panel = page.getByRole('region', { name: '월 구독' });
  await expect(panel).toContainText('월 ₩10,900');
  await panel.getByRole('button', { name: '구독하기' }).click();
  await panel
    .getByRole('group', { name: '결제' })
    .getByRole('button', { name: '결제 성공 (모의)' })
    .click();
  await expect(panel.getByRole('status')).toHaveText('구독이 시작되었습니다.', { timeout: 30_000 });
  await expect(panel).toContainText('자동으로 갱신됩니다');

  page.once('dialog', (d) => void d.accept());
  await panel.getByRole('button', { name: '자동 갱신 멈추기' }).click();
  await expect(panel.getByRole('status')).toHaveText('자동 갱신을 멈췄습니다.');
  await expect(panel).toContainText('자동 갱신이 꺼져 있습니다');
  // Turning renewal back on does not charge again.
  await panel.getByRole('button', { name: '자동 갱신 다시 켜기' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    '자동 갱신을 다시 켰습니다. 지금 결제되지는 않습니다.',
  );
  await expect(panel).toContainText('자동으로 갱신됩니다');

  await page.reload();
  const history = page.getByRole('list', { name: '구매 내역' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('월 구독');
});
