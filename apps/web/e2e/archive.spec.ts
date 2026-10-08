import { expect, test } from '@playwright/test';
import {
  apiAs,
  expectPlaying,
  openTab,
  provision,
  signIn,
  subjectFor,
  wavTone,
} from './support.ts';

test('uploads private audio, plays it, keeps it private, and deletes it', async ({ page }) => {
  const owner = subjectFor('owner');
  const stranger = subjectFor('stranger');
  await provision(owner);
  await provision(stranger);
  const name = `e2e-memo-${Date.now().toString(36)}`;
  // The declared filename becomes the default title, without its extension.
  const file = `${name}.wav`;

  await signIn(page, owner);
  await openTab(page, 'Studio');
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: file, mimeType: 'audio/wav', buffer: wavTone(3) });
  await upload.getByRole('button', { name: '업로드' }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  await openTab(page, 'Archive');

  const item = page.getByRole('region', { name: 'Archive' }).getByRole('listitem').filter({
    hasText: name,
  });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '재생' }).click();
  await expectPlaying(page);

  // Private: another account can neither find nor open it (T04/T05).
  const library = (await apiAs(owner, 'GET', '/v1/library')).json as {
    items: { ref_id: string; title: string | null }[];
  };
  const sourceId = library.items.find((i) => i.title === name)?.ref_id;
  expect(sourceId).toBeTruthy();
  const search = await apiAs(stranger, 'GET', `/v1/search?q=${encodeURIComponent(name)}`);
  expect((search.json as { items: unknown[] }).items).toEqual([]);
  expect((await apiAs(stranger, 'GET', `/v1/audio-sources/${String(sourceId)}`)).status).toBe(404);

  // Deleting blocks playback immediately; removal of the files is asynchronous.
  page.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: '삭제' }).click();
  await expect(item).toBeHidden();
  const replay = await apiAs(owner, 'POST', '/v1/playback-sessions', {
    audio_source_id: sourceId,
    device_id: 'e2e-device',
  });
  expect(replay.status).toBe(404);
});
