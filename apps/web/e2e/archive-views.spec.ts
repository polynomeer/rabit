import { expect, test } from '@playwright/test';
import { apiAs, provision, signIn, subjectFor } from './support.ts';

/** Archive views (LIB-001): everything, or one kind of item. */
test('filters the Archive by kind', async ({ page }) => {
  const subject = subjectFor('views');
  await provision(subject, { listener: true });
  const find = async (q: string, kind: string) => {
    const r = (await apiAs(subject, 'GET', `/v1/search?q=${encodeURIComponent(q)}`)).json as {
      items: { id: string; kind: string; title: string }[];
    };
    return String(r.items.find((i) => i.kind === kind && i.title === q)?.id);
  };
  await apiAs(subject, 'POST', '/v1/library', {
    ref_type: 'recording',
    ref_id: await find('Slow Orbit', 'recording'),
  });
  await apiAs(subject, 'POST', '/v1/library', {
    ref_type: 'release',
    ref_id: await find('Harbour Lights', 'release'),
  });

  await signIn(page, subject);
  const archive = page.getByRole('region', { name: 'Archive' });
  const items = archive.getByRole('list').first().getByRole('listitem');
  const views = archive.getByRole('group', { name: '보기' });
  await expect(items.filter({ hasText: 'Slow Orbit' })).toBeVisible();
  await expect(items.filter({ hasText: 'Harbour Lights' })).toBeVisible();

  await views.getByRole('radio', { name: '저장한 곡' }).check();
  await expect(items.filter({ hasText: 'Slow Orbit' })).toBeVisible();
  await expect(items.filter({ hasText: 'Harbour Lights' })).toHaveCount(0);

  await views.getByRole('radio', { name: '저장한 앨범' }).check();
  await expect(items.filter({ hasText: 'Harbour Lights' })).toBeVisible();
  await expect(items.filter({ hasText: 'Slow Orbit' })).toHaveCount(0);

  await views.getByRole('radio', { name: 'Audio Log' }).check();
  await expect(archive.getByText('이 보기에 해당하는 항목이 없습니다.')).toBeVisible();
});
