import { expect, test } from '@playwright/test';
import { expectPlaying, openTab, provision, signIn, subjectFor } from './support.ts';

/**
 * Audio Log from the microphone (LOG-004): record → stop → preview → private save.
 * Headless Chromium has no working microphone here, so the test hands the page a
 * stream from a WebAudio oscillator; recording, upload and processing are real.
 */
test('records an Audio Log with the microphone and keeps it private', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      const ctx = new AudioContext();
      const tone = ctx.createOscillator();
      const out = ctx.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      return Promise.resolve(out.stream);
    };
  });
  const subject = subjectFor('recorder');
  await provision(subject);
  await signIn(page, subject);
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload.getByRole('radio', { name: 'Audio Log' }).check();
  const title = `Voice memo ${Date.now().toString(36)}`;
  await upload.getByLabel('제목').fill(title);

  const mic = upload.getByRole('group', { name: '마이크 녹음' });
  await mic.getByRole('button', { name: '마이크로 녹음' }).click();
  await expect(mic.getByRole('status')).toContainText('녹음 중');
  await page.waitForTimeout(2500);
  await mic.getByRole('button', { name: '녹음 중지' }).click();
  await expect(mic.getByLabel('녹음 미리듣기')).toBeVisible();
  // The recording replaces the file picker.
  await expect(upload.getByLabel('오디오 파일')).toBeHidden();

  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  await openTab(page, 'Archive');
  const item = page.getByRole('region', { name: 'Archive' }).getByRole('listitem').filter({
    hasText: title,
  });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '재생' }).click();
  await expectPlaying(page);
});

test('explains a refused microphone and leaves file upload available', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  const subject = subjectFor('recorder-denied');
  await provision(subject);
  await signIn(page, subject);
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload.getByRole('radio', { name: 'Audio Log' }).check();
  await upload.getByRole('button', { name: '마이크로 녹음' }).click();
  await expect(upload.getByText(/마이크를 쓸 수 없습니다/)).toBeVisible();
  await expect(upload.getByLabel('오디오 파일')).toBeVisible();
});

/**
 * A recording without any audio (the audio clock never ran, e.g. a stalled output
 * device on the host) is an empty file: the page says so and keeps it out of the
 * upload instead of sending a zero-byte upload intent the API rejects.
 */
test('says when a recording captured no audio and does not upload it', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const out = ctx.createMediaStreamDestination();
      await ctx.suspend();
      return out.stream;
    };
  });
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/uploads') && r.method() === 'POST') uploads.push(r.url());
  });
  const subject = subjectFor('recorder-silent');
  await provision(subject);
  await signIn(page, subject);
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload.getByRole('radio', { name: 'Audio Log' }).check();
  await upload.getByLabel('제목').fill('Silent memo');
  const mic = upload.getByRole('group', { name: '마이크 녹음' });
  await mic.getByRole('button', { name: '마이크로 녹음' }).click();
  await expect(mic.getByRole('status')).toContainText('녹음 중');
  await page.waitForTimeout(1500);
  await mic.getByRole('button', { name: '녹음 중지' }).click();
  await expect(mic.getByText(/녹음된 소리가 없습니다/)).toBeVisible();
  await expect(mic.getByLabel('녹음 미리듣기')).toBeHidden();
  await expect(mic.getByRole('button', { name: '마이크로 녹음' })).toBeVisible();
  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByText(/VALIDATION_FAILED/)).toBeHidden();
  // An empty file from the picker is refused the same way, before any upload intent.
  await upload.getByLabel('오디오 파일').setInputFiles({
    name: 'empty.m4a',
    mimeType: 'audio/mp4',
    buffer: Buffer.alloc(0),
  });
  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByRole('status')).toHaveText('빈 파일은 올릴 수 없습니다.');
  expect(uploads).toEqual([]);
});
