import { expect, test } from '@playwright/test';
import { apiAs, asOperator, openTab, provision, signIn, subjectFor } from './support.ts';

test('Account shows the subscription and each entitlement with its origin', async ({ page }) => {
  const subject = subjectFor('account');
  const userId = await provision(subject, { listener: true });
  const found = (await apiAs(subject, 'GET', '/v1/search?q=Harbour Lights')).json as {
    items: { id: string; kind: string }[];
  };
  const release = found.items.find((i) => i.kind === 'release')?.id;
  expect(release).toBeTruthy();
  const grant = await asOperator('POST', '/v1/ops/entitlements', {
    user_id: userId,
    scope: 'release',
    resource_id: release,
    capabilities: ['play'],
    reason: 'e2e promo',
  });
  expect(grant.status).toBe(201);

  await signIn(page, subject);
  await openTab(page, 'Account');
  const card = page.getByRole('region', { name: '구독과 이용권' });
  await expect(card).toContainText('이용 중');
  const list = card.getByRole('list', { name: '이용권' }).getByRole('listitem');
  await expect(list.filter({ hasText: '전체 카탈로그' })).toContainText('구독');
  const granted = list.filter({ hasText: 'Harbour Lights' });
  await expect(granted).toContainText('부여');
  await expect(granted).toContainText('유효');

  // The covered release links to its page.
  await granted.getByRole('link', { name: 'Harbour Lights' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Harbour Lights' })).toBeVisible();
});
