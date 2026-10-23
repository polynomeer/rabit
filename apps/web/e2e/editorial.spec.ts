import { expect, test } from '@playwright/test';
import { asOperator, provision, signIn, subjectFor } from './support.ts';

/** Editorial shelves (ADR-0029): an operator curates, a listener sees it on Home. */
test('an operator publishes a shelf and a listener in its country sees it on Home', async ({
  browser,
}) => {
  const title = `이번 주의 발견 ${Date.now().toString(36)}`;
  const operator = await browser.newPage();
  await operator.goto('/');
  await operator.getByLabel('개발용 로그인 ID').fill(subjectFor('editor'));
  await operator.getByLabel(/운영자/).check();
  await operator.getByRole('button', { name: '로그인' }).click();
  await operator.goto('/#/ops/editorial');
  await operator.getByLabel(/처리 사유/).fill('weekly picks');

  await operator.getByRole('button', { name: '새 선반' }).click();
  const form = operator.getByRole('form', { name: '편집 선반' });
  await form.getByLabel('제목').fill(title);
  await form.getByLabel(/지역/).fill('KR');
  await form.getByLabel('공개', { exact: true }).check();
  await form.getByLabel('앨범 제목으로 찾기').fill('Harbour Lights');
  await form.getByRole('button', { name: '찾기' }).click();
  await form.getByRole('button', { name: 'Harbour Lights 추가' }).click();
  await form.getByLabel('Harbour Lights 한 줄 소개').fill('밤바다를 닮은 앨범');
  await form.getByRole('button', { name: '선반 저장' }).click();
  await expect(
    operator.getByRole('list', { name: '편집 선반 목록' }).getByRole('listitem').filter({
      hasText: title,
    }),
  ).toContainText('공개');

  const listener = subjectFor('editorial-listener');
  await provision(listener, { listener: true });
  const page = await browser.newPage();
  await signIn(page, listener);
  const shelf = page.getByRole('list', { name: title });
  await expect(shelf).toContainText('Harbour Lights');
  await expect(shelf).toContainText('밤바다를 닮은 앨범');

  // Leave Home as the other tests expect it.
  const list = (await asOperator('GET', '/v1/ops/editorial/shelves', {})).json as {
    items: { shelf_id: string; title: string }[];
  };
  for (const s of list.items.filter((i) => i.title === title)) {
    await asOperator('DELETE', `/v1/ops/editorial/shelves/${s.shelf_id}?reason=e2e%20cleanup`, {});
  }
});
