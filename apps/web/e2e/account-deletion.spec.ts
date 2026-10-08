import { expect, test } from '@playwright/test';
import { openTab, provision, signIn, subjectFor, withDb } from './support.ts';

/** Account deletion from the Account tab (invariant 12, LIB-008). */
test('deletes the account after a typed confirmation and signs out', async ({ page }) => {
  const subject = subjectFor('leaver');
  const userId = await provision(subject);
  await signIn(page, subject);
  await openTab(page, 'Account');

  const form = page.getByRole('form', { name: '계정 삭제' });
  const submit = form.getByRole('button', { name: '계정 삭제' });
  await expect(submit).toBeDisabled();
  await form.getByLabel("확인을 위해 '삭제'를 입력하세요").fill('지워');
  await expect(submit).toBeDisabled();
  await form.getByLabel("확인을 위해 '삭제'를 입력하세요").fill('삭제');
  await submit.click();

  // Signed out at once; the server has the account in deletion.
  await expect(page.getByLabel('개발용 로그인 ID')).toBeVisible();
  await expect
    .poll(() =>
      withDb(async (db) => {
        const r = await db.query<{ status: string }>('SELECT status FROM app_user WHERE id = $1', [
          userId,
        ]);
        return r.rows[0]?.status;
      }),
    )
    .toMatch(/^(deletion_requested|deleted)$/);
});
