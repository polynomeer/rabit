import { expect, test } from '@playwright/test';
import { apiAs, asOperator, provision, signIn, subjectFor } from './support.ts';

/**
 * Album purchase with the sandbox provider (ADR-0018, provisional): a KR user
 * without a subscription buys an album, pays on the mock checkout, and can then
 * play it; the order shows in the purchase history.
 */
test('buys an album with the mock provider and plays it without a subscription', async ({
  page,
}) => {
  const subject = subjectFor('buyer');
  const userId = await provision(subject);
  expect(
    (
      await asOperator('PUT', `/v1/ops/users/${userId}/license-country`, {
        license_country: 'KR',
        reason: 'e2e setup',
      })
    ).status,
  ).toBe(200);

  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');
  expect(release).toBeTruthy();
  const releaseId = String(release?.id);
  // One offer per release: a re-run finds the offer from the previous run.
  const offer = await asOperator('POST', '/v1/ops/offers', {
    release_id: releaseId,
    territories: ['KR'],
    price_minor: 11000,
    reason: 'e2e offer',
  });
  expect([201, 409]).toContain(offer.status);

  await signIn(page, subject);
  await page.goto(`/#/release/${releaseId}`);
  const tracks = page.getByRole('list', { name: '트랙' });
  await expect(tracks.getByRole('button', { name: '재생' }).first()).toBeDisabled();

  const panel = page.getByRole('region', { name: '앨범 구매' });
  await expect(panel).toContainText('₩11,000');
  await expect(panel).toContainText('저작권을 구매하는 것은 아닙니다');
  const buy = panel.getByRole('button', { name: '구매하기' });
  await expect(buy).toBeDisabled();
  await panel.getByLabel('위 내용을 확인했습니다').check();
  await buy.click();

  const checkout = panel.getByRole('group', { name: '결제' });
  await expect(checkout).toContainText('모의 결제');
  await checkout.getByRole('button', { name: '결제 성공 (모의)' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    '구매가 완료되었습니다. 이제 재생할 수 있습니다.',
    {
      timeout: 30_000,
    },
  );
  await expect(panel).toContainText('구매한 앨범');
  await expect(tracks.getByRole('button', { name: '재생' }).first()).toBeEnabled();

  await page.goto('/#/account');
  const history = page.getByRole('list', { name: '구매 내역' });
  await expect(history.getByRole('listitem').filter({ hasText: 'Harbour Lights' })).toContainText(
    '구매 완료',
  );
});
