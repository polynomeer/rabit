import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, openTab, provision, signIn, subjectFor, withDb } from './support.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// ULIDs start with a timestamp character 0–7; the rest only needs to be unique here.
const itemId = () => `pli_0${[...randomBytes(25)].map((b) => CROCKFORD[b % 32]).join('')}`;

test('pages a large playlist and recovers when it changed in the meantime', async ({ page }) => {
  const subject = subjectFor('paging');
  await provision(subject, { listener: true });
  await signIn(page, subject);
  await openTab(page, 'Playlists');

  const title = `Big ${Date.now().toString(36)}`;
  await page.getByLabel('플레이리스트 이름').fill(title);
  await page.getByRole('button', { name: '만들기' }).click();
  const entry = page.getByRole('listitem').filter({ hasText: title });
  await expect(entry).toBeVisible();

  // 130 catalog items, seeded directly: the UI path for one item is covered elsewhere.
  const playlistId = (
    (await apiAs(subject, 'GET', '/v1/playlists')).json as {
      items: { playlist_id: string; title: string }[];
    }
  ).items.find((p) => p.title === title)?.playlist_id;
  expect(playlistId).toBeTruthy();
  await withDb(async (db) => {
    const recs = await db.query<{ id: string }>('SELECT id FROM recording ORDER BY title');
    for (let rank = 0; rank < 130; rank++) {
      await db.query(
        `INSERT INTO playlist_item (id, playlist_id, rank, ref_type, ref_id)
         VALUES ($1, $2, $3, 'recording', $4)`,
        [itemId(), playlistId, rank, recs.rows[rank % recs.rows.length]?.id],
      );
    }
  });

  const items = page.locator('.card ol > li');
  await entry.getByRole('button', { name: title }).click();
  await expect(items).toHaveCount(100);
  await page.getByRole('button', { name: '더 보기 (100/130)' }).click();
  await expect(items).toHaveCount(130);
  await expect(page.getByRole('button', { name: /더 보기/ })).toBeHidden();
  await expect(items.nth(129).locator('strong')).not.toHaveText('(삭제됨)');

  // Edited elsewhere after the first page was read: the stale cursor is refused
  // and the client reloads instead of showing a mixed list.
  await entry.getByRole('button', { name: title }).click();
  await expect(items).toHaveCount(100);
  const current = await apiAs(subject, 'GET', `/v1/playlists/${String(playlistId)}`);
  const renamed = await apiAs(
    subject,
    'PATCH',
    `/v1/playlists/${String(playlistId)}`,
    { title: `${title} (renamed)` },
    { 'if-match': current.etag ?? '' },
  );
  expect(renamed.status).toBe(200);
  await page.getByRole('button', { name: /더 보기/ }).click();
  await expect(page.getByRole('status')).toHaveText('다른 곳에서 변경되어 다시 불러왔습니다.');
  await expect(page.getByRole('heading', { name: `${title} (renamed)` })).toBeVisible();
  await expect(items).toHaveCount(100);

  // Moving uses absolute positions.
  const second = (await items.nth(1).locator('strong').textContent()) ?? '';
  await items.nth(1).getByRole('button', { name: '위로' }).click();
  await expect(items.nth(0).locator('strong')).toHaveText(second);
});
