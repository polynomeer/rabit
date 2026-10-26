import { expect, test, type Page } from '@playwright/test';
import { apiAs, asOperator, provision, signIn, subjectFor, withDb } from './support.ts';

/** Rediscover (EX-06, ADR-0035): saved tracks not played for a while, honest about history. */
test('lists a long-quiet saved track without guessing it was not played', async ({ page }) => {
  const flag = await asOperator('PUT', '/v1/ops/features/exploration_rediscover', {
    override: { enabled: true, rollout_percent: 100 },
    reason: 'e2e rediscover',
  });
  expect(flag.status).toBe(200);
  try {
    await run(page);
  } finally {
    await asOperator('PUT', '/v1/ops/features/exploration_rediscover', {
      override: null,
      reason: 'e2e rediscover done',
    });
  }
});

async function run(page: Page) {
  const subject = subjectFor('rediscover');
  const userId = await provision(subject, { listener: true });
  const found = (await apiAs(subject, 'GET', '/v1/search?q=Midnight%20Harbour')).json as {
    items: { id: string; kind: string }[];
  };
  const recording = found.items.find((i) => i.kind === 'recording');
  expect(recording).toBeTruthy();
  const saved = await apiAs(subject, 'POST', '/v1/library', {
    ref_type: 'recording',
    ref_id: recording?.id,
  });
  expect(saved.status).toBe(201);
  // Saved 200 days ago, never played since: seeding the date directly.
  await withDb((db) =>
    db.query(`UPDATE library_item SET saved_at = now() - interval '200 days' WHERE user_id = $1`, [
      userId,
    ]),
  );

  await signIn(page, subject);
  await page.goto('/#/dig');
  await page.getByRole('link', { name: '잊고 있던 음악' }).click();
  const list = page.getByRole('list', { name: '재발견 후보' });
  const item = list.getByRole('listitem').filter({ hasText: 'Midnight Harbour' });
  await expect(item).toContainText('감상 기록 없음 · 저장 날짜 기준');
  await expect(item).toContainText('2024. 3. 1. 발매');

  // A longer window leaves it out; the empty state says why.
  await page.getByRole('button', { name: '365일 넘게' }).click();
  await expect(page.getByText('365일 넘게 듣지 않은 저장 곡이 없어요.')).toBeVisible();
}
