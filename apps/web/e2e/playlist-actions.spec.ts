import { expect, test } from '@playwright/test';
import { apiAs, openTab, provision, signIn, subjectFor, wavTone } from './support.ts';

/** LIB-003: add tracks and private audio to a playlist, rename both. */
test('adds a catalog track and private audio to a playlist and renames things', async ({
  page,
}) => {
  const subject = subjectFor('pl-actions');
  await provision(subject, { listener: true });
  await apiAs(subject, 'POST', '/v1/playlists', { title: 'Road trip' });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Paper%20Lantern')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const lantern = search.items.find((i) => i.kind === 'recording' && i.title === 'Paper Lantern');

  await signIn(page, subject);

  // A catalog track from its page.
  await page.goto(`/#/recording/${String(lantern?.id)}`);
  await page.getByRole('button', { name: '플레이리스트에 추가' }).click();
  const add = page.getByRole('form', { name: '플레이리스트에 추가' });
  await add.getByLabel('추가할 플레이리스트').selectOption({ label: 'Road trip' });
  await add.getByRole('button', { name: '추가' }).click();
  await expect(add.getByRole('status')).toHaveText("'Road trip'에 추가했습니다.");

  // Private audio from the Archive, renamed first.
  await openTab(page, 'Archive');
  const name = `e2e-take-${Date.now().toString(36)}`;
  const upload = page.getByRole('form', { name: '오디오 업로드' });
  await upload
    .getByLabel('오디오 파일')
    .setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wavTone(2) });
  await upload.getByRole('button', { name: '업로드', exact: true }).click();
  await expect(upload.getByRole('status')).toBeHidden({ timeout: 60_000 });
  const archive = page.getByRole('region', { name: 'Archive' });
  let item = archive.getByRole('listitem').filter({ hasText: name });
  await item.getByRole('button', { name: '이름 바꾸기' }).click();
  await archive.getByLabel('오디오 이름').fill('Garage session');
  await archive
    .getByRole('form', { name: '이름 바꾸기' })
    .getByRole('button', { name: '저장' })
    .click();
  item = archive.getByRole('listitem').filter({ hasText: 'Garage session' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '플레이리스트에 추가' }).click();
  await item.getByRole('button', { name: '추가', exact: true }).click();
  await expect(item.getByRole('status')).toHaveText("'Road trip'에 추가했습니다.");

  // The playlist holds both, and can be renamed.
  await openTab(page, 'Playlists');
  const lists = page.getByRole('region', { name: 'Playlists' });
  await lists.getByRole('button', { name: 'Road trip' }).click();
  await expect(lists.getByText('Paper Lantern')).toBeVisible();
  await expect(lists.getByText('Garage session')).toBeVisible();
  await lists.getByLabel('새 이름').fill('Long road trip');
  await lists.getByRole('button', { name: '이름 바꾸기' }).click();
  await expect(lists.getByRole('button', { name: 'Long road trip' })).toBeVisible();

  // Deleting the playlist keeps what was in it.
  page.once('dialog', (d) => void d.accept());
  await lists.getByRole('button', { name: '플레이리스트 삭제' }).click();
  await expect(lists.getByRole('status')).toHaveText('플레이리스트를 삭제했습니다.');
  await expect(lists.getByRole('button', { name: 'Long road trip' })).toHaveCount(0);
  await openTab(page, 'Archive');
  await expect(archive.getByRole('listitem').filter({ hasText: 'Garage session' })).toBeVisible();
});
