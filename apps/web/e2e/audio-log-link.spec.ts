import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor, wavTone } from './support.ts';

/** LOG-003: an Audio Log can be linked to the catalog track it is about, and unlinked. */
test('links an Audio Log to a catalog track and unlinks it', async ({ page }) => {
  const subject = subjectFor('loglink');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  const name = `e2e-practice-${Date.now().toString(36)}`;
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload.getByRole('radio', { name: 'Audio Log' }).check();
  await upload.getByLabel('제목').fill(name);
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wavTone(2) });
  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  await openTab(page, 'Archive');

  const archive = page.getByRole('region', { name: 'Archive' });
  const item = archive.getByRole('listitem').filter({ hasText: name });
  await item.getByRole('button', { name: '편집' }).click();
  const editor = archive.getByRole('form', { name: 'Audio Log 편집' });
  await editor.getByLabel('카탈로그에서 곡 찾기').fill('Paper Lantern');
  await editor.getByRole('button', { name: '찾기' }).click();
  await editor.getByRole('button', { name: 'Paper Lantern 연결' }).click();
  await expect(editor.getByRole('link', { name: 'Paper Lantern' })).toBeVisible();
  await editor.getByRole('button', { name: '저장' }).click();

  const link = item.getByRole('link', { name: '연결 곡' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Paper Lantern' })).toBeVisible();

  await page.goBack();
  await item.getByRole('button', { name: '편집' }).click();
  await expect(editor.getByRole('link', { name: 'Paper Lantern' })).toBeVisible();
  await editor.getByRole('button', { name: '연결 해제' }).click();
  await editor.getByRole('button', { name: '저장' }).click();
  await expect(item.getByRole('link', { name: '연결 곡' })).toHaveCount(0);
});
