import { expect, test } from '@playwright/test';
import { apiAs, asOperator, provision, subjectFor } from './support.ts';

/**
 * Operator console, Sales (ADR-0018, provisional): put a release on sale, look up
 * a paid order with its provider events and ledger, refund it, end the sale.
 */
test('operators sell a release, inspect a paid order and refund it', async ({ page }) => {
  const buyer = subjectFor('ops-buyer');
  const buyerId = await provision(buyer);
  await asOperator('PUT', `/v1/ops/users/${buyerId}/license-country`, {
    license_country: 'KR',
    reason: 'e2e setup',
  });
  const search = (await apiAs(buyer, 'GET', '/v1/search?q=Paper%20Sky')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const releaseId = String(
    search.items.find((i) => i.kind === 'release' && i.title === 'Paper Sky')?.id,
  );
  // A previous run may have left an offer on sale.
  const before = (await asOperator('GET', `/v1/ops/releases/${releaseId}/offers`, {})).json as {
    items: { offer_id: string; status: string }[];
  } | null;
  for (const o of before?.items.filter((x) => x.status === 'on_sale') ?? []) {
    await asOperator('POST', `/v1/ops/offers/${o.offer_id}/withdraw`, { reason: 'e2e reset' });
  }

  await page.goto('/');
  await page.getByLabel('개발용 로그인 ID').fill(subjectFor('sales-op'));
  await page.getByLabel(/운영자/).check();
  await page.getByRole('button', { name: '로그인' }).click();
  await page.goto('/#/ops/sales');
  await page.getByLabel('처리 사유 (감사 기록에 남습니다)').fill('e2e sales check');

  const offers = page.getByRole('region', { name: '앨범 판매' });
  await offers.getByLabel('앨범 ID').fill(releaseId);
  await offers.getByRole('button', { name: '조회' }).click();
  const create = offers.getByRole('form', { name: '판매 등록' });
  await create.getByLabel('가격 (원, 부가세 포함)').fill('9900');
  await create.getByRole('button', { name: '판매 등록' }).click();
  const list = offers.getByRole('list', { name: '판매 목록' });
  await expect(list.getByRole('listitem').filter({ hasText: '판매 중' })).toContainText('₩9,900');

  // The buyer pays through the sandbox provider.
  const offer = (await apiAs(buyer, 'GET', `/v1/releases/${releaseId}/offer`)).json as {
    offer_id: string;
  };
  const created = await apiAs(
    buyer,
    'POST',
    '/v1/orders',
    { offer_id: offer.offer_id },
    { 'idempotency-key': `e2e-${crypto.randomUUID()}` },
  );
  expect(created.status).toBe(201);
  const order = created.json as { order_id: string; checkout_url: string };
  await fetch(`${order.checkout_url}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outcome: 'succeeded' }),
  });
  await expect
    .poll(
      async () =>
        ((await apiAs(buyer, 'GET', `/v1/orders/${order.order_id}`)).json as { status: string })
          .status,
    )
    .toBe('fulfilled');

  const lookup = page.getByRole('region', { name: '주문 조회' });
  await lookup.getByLabel('주문 ID').fill(order.order_id);
  await lookup.getByRole('button', { name: '조회' }).click();
  await expect(lookup.getByRole('list', { name: '결제사 이벤트' })).toContainText(
    'payment.succeeded',
  );
  await expect(lookup.getByRole('table', { name: '장부' })).toContainText('vat_payable');
  page.once('dialog', (d) => void d.accept());
  await lookup.getByRole('button', { name: '전액 환불' }).click();
  await expect(lookup.getByRole('status')).toContainText('전액 환불: 완료');
  await expect
    .poll(
      async () =>
        ((await apiAs(buyer, 'GET', `/v1/orders/${order.order_id}`)).json as { status: string })
          .status,
    )
    .toBe('refunded');

  await list.getByRole('button', { name: '판매 중단' }).click();
  await expect(list.getByRole('listitem').first()).toContainText('판매 중단됨');
});
