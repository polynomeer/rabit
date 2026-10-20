import { expect, test } from '@playwright/test';
import { apiAs, expectPlaying, provision, signIn, subjectFor } from './support.ts';

/** Each playback session reports its quality once when it ends (QoE, slo.md). */
test('reports the quality of a session when the next track starts', async ({ page }) => {
  const subject = subjectFor('playback-quality');
  await provision(subject, { listener: true });
  const search = (await apiAs(subject, 'GET', '/v1/search?q=Harbour%20Lights')).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const release = search.items.find((i) => i.kind === 'release' && i.title === 'Harbour Lights');

  const reports: { url: string; body: Record<string, unknown> }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/quality')) {
      reports.push({ url: r.url(), body: r.postDataJSON() as Record<string, unknown> });
    }
  });

  await signIn(page, subject);
  await page.goto(`/#/release/${String(release?.id)}`);
  await page.getByRole('button', { name: '전체 재생' }).click();
  await expectPlaying(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '다음 곡' }).click();
  await expectPlaying(page);

  await expect.poll(() => reports.length).toBe(1);
  const r = reports[0]?.body ?? {};
  expect(r).toMatchObject({ platform: 'web', error: null });
  expect(r['startup_ms']).toEqual(expect.any(Number));
  expect(r['startup_ms'] as number).toBeLessThan(10_000);
  expect(r['played_ms'] as number).toBeGreaterThan(500);
});
