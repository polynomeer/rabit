import { expect, test } from '@playwright/test';
import { apiAs, openTab, provision, signIn, subjectFor, wavTone } from './support.ts';

test('edits an Audio Log, shows its waveform and removes a saved item', async ({ page }) => {
  const subject = subjectFor('archive');
  await provision(subject, { listener: true });
  await signIn(page, subject);

  // Record an Audio Log through the upload form.
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload.getByLabel('Audio Log').check();
  const title = `Memo ${Date.now().toString(36)}`;
  await upload.getByLabel('제목').fill(title);
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: 'memo.wav', mimeType: 'audio/wav', buffer: wavTone(3) });
  await upload.getByRole('button', { name: '업로드', exact: true }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  await openTab(page, 'Archive');

  const archive = page.getByRole('region', { name: 'Archive' });
  let item = archive.getByRole('listitem').filter({ hasText: title });
  await expect(item).toBeVisible();

  // Edit title, note and tags; only changed fields are sent.
  await item.getByRole('button', { name: '편집' }).click();
  const editor = page.getByRole('form', { name: 'Audio Log 편집' });
  const renamed = `${title} (morning)`;
  await editor.getByLabel('제목').fill(renamed);
  await editor.getByLabel('메모').fill('Hummed the chorus on the bus');
  await editor.getByLabel('태그 (쉼표로 구분)').fill('idea, melody');
  await editor.getByRole('button', { name: '저장' }).click();
  await expect(editor).toBeHidden();
  item = archive.getByRole('listitem').filter({ hasText: renamed });
  await expect(item).toContainText('#idea #melody');
  await expect(item).toContainText('Hummed the chorus on the bus');
  const logs = (await apiAs(subject, 'GET', '/v1/audio-logs')).json as {
    items: { title: string; note: string | null; tags: string[] }[];
  };
  expect(logs.items[0]).toMatchObject({
    title: renamed,
    note: 'Hummed the chorus on the bus',
    tags: ['idea', 'melody'],
  });

  // Private audio shows its waveform while playing.
  await item.getByRole('button', { name: '재생' }).click();
  const waveform = page.locator('.player svg.waveform');
  await expect(waveform).toBeVisible();
  await expect(waveform.locator('rect')).toHaveCount(120);

  // A saved catalog item can be removed from the library.
  await openTab(page, 'Search');
  await page.getByLabel('검색어').fill('Morning Tide');
  await page.getByRole('button', { name: '검색' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Morning Tide' })
    .first()
    .getByRole('button', { name: '저장' })
    .click();
  await expect
    .poll(async () => {
      const lib = (await apiAs(subject, 'GET', '/v1/library?ref_type=recording')).json as {
        items: unknown[];
      };
      return lib.items.length;
    })
    .toBe(1);
  await openTab(page, 'Archive');
  const saved = archive.getByRole('listitem').filter({ hasText: 'Morning Tide' });
  await saved.getByRole('button', { name: '라이브러리에서 빼기' }).click();
  await expect(saved).toBeHidden();
});

test('cancels an upload during transfer and releases it on the server', async ({ page }) => {
  const subject = subjectFor('cancel');
  await provision(subject);
  await signIn(page, subject);

  // Hold the transfer to object storage so the cancel happens mid-upload.
  let releaseTransfer: () => void = () => {
    /* replaced once the transfer is intercepted */
  };
  await page.route(
    (url) => url.pathname.startsWith('/rabit-quarantine/'),
    (route) =>
      new Promise<void>((resolve) => {
        releaseTransfer = () => {
          void route.abort().catch(() => undefined);
          resolve();
        };
      }),
  );
  const intent = page.waitForResponse(
    (r) => r.url().endsWith('/v1/uploads') && r.request().method() === 'POST',
  );
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: 'big.wav', mimeType: 'audio/wav', buffer: wavTone(5) });
  await upload.getByRole('button', { name: '업로드', exact: true }).click();
  const uploadId = ((await (await intent).json()) as { upload: { upload_id: string } }).upload
    .upload_id;
  await expect(upload.getByRole('status')).toHaveText('전송 중…');

  await upload.getByRole('button', { name: '업로드 취소' }).click();
  await expect(upload.getByRole('status')).toHaveText('업로드를 취소했습니다.');
  releaseTransfer();
  const state = (await apiAs(subject, 'GET', `/v1/uploads/${uploadId}`)).json as { state: string };
  expect(state.state).toBe('cancelled');
  // Nothing appears in the Archive.
  await openTab(page, 'Archive');
  await expect(page.getByRole('region', { name: 'Archive' }).getByRole('listitem')).toHaveText([
    /아직 아무것도 없습니다/,
  ]);
});
