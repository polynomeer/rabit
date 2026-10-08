import { expect, test } from '@playwright/test';
import { apiAs, provision, signIn, subjectFor } from './support.ts';

/** Physical Collection (COL-001/002/007): manual records, separate from playback rights. */
test('records owned CDs and LPs, from a release page and by hand', async ({ page }) => {
  const subject = subjectFor('collector');
  await provision(subject);
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');
  expect(release).toBeTruthy();

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  const add = page.getByRole('form', { name: '실물 컬렉션에 추가' });
  await add.getByLabel('매체').selectOption('vinyl');
  await add.getByRole('button', { name: '실물 컬렉션에 추가' }).click();
  await expect(add.getByRole('status')).toHaveText('실물 컬렉션에 추가했습니다.');
  // The release page now says it is owned physically, separate from playback (PLY-002).
  await expect(page.getByRole('note')).toHaveText(
    /실물 소장: LP·바이닐 \(본인 신고 · 재생권과 별개\)/,
  );

  await page.goto('/#/archive');
  const collection = page.getByRole('region', { name: '실물 컬렉션' });
  // The page says plainly that owning the record is not a playback right (COL-007).
  await expect(collection).toContainText('디지털 재생권과는 별개');
  const list = collection.getByRole('list', { name: '실물 컬렉션 목록' });
  const lp = list.getByRole('listitem').filter({ hasText: 'Harbour Lights' });
  await expect(lp).toContainText('LP·바이닐');
  await expect(lp).toContainText('실물 소장 기록 (본인 신고)');
  await expect(lp.getByRole('link', { name: 'Harbour Lights' })).toBeVisible();

  // By hand, with a barcode whose check digit is wrong, then right.
  const form = collection.getByRole('form', { name: '실물 등록' });
  await form.getByLabel('제목').fill('Live at the Pier');
  await form.getByLabel('바코드 EAN/UPC (선택)').fill('4006381333932');
  await form.getByRole('button', { name: '등록' }).click();
  await expect(form.getByText(/VALIDATION_FAILED/)).toBeVisible();
  await form.getByLabel('바코드 EAN/UPC (선택)').fill('4006381333931');
  await form.getByRole('button', { name: '등록' }).click();
  const cd = list.getByRole('listitem').filter({ hasText: 'Live at the Pier' });
  await expect(cd).toContainText('4006381333931');

  await cd.getByRole('button', { name: '편집' }).click();
  // While editing, the title is in an input, so find the form in the list.
  const edit = list.getByRole('form', { name: '실물 편집' });
  await expect(edit.getByLabel('제목')).toHaveValue('Live at the Pier');
  await edit.getByLabel('메모 (선택)').fill('Signed sleeve');
  await edit.getByRole('button', { name: '저장' }).click();
  await expect(cd).toContainText('Signed sleeve');

  page.once('dialog', (d) => void d.accept());
  await cd.getByRole('button', { name: '삭제' }).click();
  await expect(cd).toHaveCount(0);
  await expect(lp).toBeVisible();
});
