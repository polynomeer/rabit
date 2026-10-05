import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { apiAs, provision, subjectFor, withDb } from './support.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = () => `0${[...randomBytes(25)].map((b) => CROCKFORD[b % 32]).join('')}`;

async function signInAs(page: Page, subject: string, operator: boolean) {
  await page.goto('/');
  await page.getByLabel('개발용 로그인 ID').fill(subject);
  if (operator) await page.getByLabel(/운영자/).check();
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
}

async function catalogId(subject: string, q: string, kind: string) {
  const r = (await apiAs(subject, 'GET', `/v1/search?q=${encodeURIComponent(q)}`)).json as {
    items: { id: string; kind: string; title: string }[];
  };
  const hit = r.items.find((i) => i.kind === kind && i.title === q);
  expect(hit, `${kind} ${q}`).toBeTruthy();
  return String(hit?.id);
}

test('the console is for operators only', async ({ page }) => {
  const subject = subjectFor('notop');
  await provision(subject);
  await signInAs(page, subject, false);
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  await expect(menu.getByRole('button', { name: 'Ops' })).toHaveCount(0);
  await page.goto('/#/ops/users');
  await expect(page.getByRole('status')).toHaveText('운영자 권한이 필요합니다.');
});

test('operators support a user, triage a report, retry a job and remove audio', async ({
  page,
}) => {
  const customer = subjectFor('customer');
  const customerId = await provision(customer, { listener: true });
  const release = await catalogId(customer, 'Harbour Lights', 'release');
  const lantern = await catalogId(customer, 'Paper Lantern', 'recording');
  const filed = await apiAs(customer, 'POST', '/v1/reports', {
    subject_type: 'recording',
    subject_id: lantern,
    reason_code: 'undisclosed_ai',
    details: 'Sounds generated',
  });
  expect(filed.status).toBe(201);
  const deadKind = `e2e.dead.${Date.now().toString(36)}`;
  await withDb((db) =>
    db.query(
      `INSERT INTO job (id, kind, payload, dedupe_key, status, attempts, max_attempts, last_error)
       VALUES ($1, $2, '{}', $3, 'dead', 5, 5, 'simulated failure')`,
      [`job_${ulid()}`, deadKind, `e2e:${deadKind}`],
    ),
  );

  await signInAs(page, subjectFor('operator'), true);
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('button', { name: 'Ops' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: '운영' })).toBeVisible();

  // A reason is required before looking at a user or changing anything.
  const lookup = page.getByRole('button', { name: '지원 요약 조회' });
  await page.getByLabel('사용자 ID').fill(customerId);
  await expect(lookup).toBeDisabled();
  await page.getByLabel(/처리 사유/).fill('ticket 4711');
  await lookup.click();
  const summary = page.getByRole('region', { name: '요약: account' });
  await expect(summary).toContainText('KR');

  // License country, then a release entitlement that is suspended again.
  const country = page.getByRole('form', { name: '라이선스 지역 변경' });
  await country.getByLabel('라이선스 지역').fill('jp');
  await country.getByRole('button', { name: '변경' }).click();
  await expect(page.getByRole('status')).toContainText('라이선스 지역 변경: 완료');
  await expect(summary).toContainText('JP');
  const grant = page.getByRole('form', { name: '이용권 부여' });
  await grant.getByLabel('앨범 또는 곡 ID').fill(release);
  await grant.getByRole('button', { name: '부여' }).click();
  await expect(page.getByRole('status')).toContainText('이용권 부여: 완료');
  const ent = page
    .getByRole('list', { name: '사용자 이용권' })
    .getByRole('listitem')
    .filter({ hasText: release });
  await expect(ent).toContainText('active');
  await ent.getByRole('button', { name: '일시 중지' }).click();
  await expect(ent).toContainText('suspended');

  // Reports: triage moves it out of "received".
  await page
    .getByRole('navigation', { name: '운영 메뉴' })
    .getByRole('link', { name: '신고' })
    .click();
  const reports = page.getByRole('list', { name: '신고 목록' }).getByRole('listitem');
  const report = reports.filter({ hasText: 'Sounds generated' });
  await expect(report).toContainText('undisclosed_ai');
  await report.getByRole('button', { name: '분류' }).click();
  await expect(report).toHaveCount(0);
  await page.getByLabel('신고 상태').selectOption('triaged');
  await expect(reports.filter({ hasText: 'Sounds generated' })).toBeVisible();

  // Jobs: a dead job is retried.
  await page
    .getByRole('navigation', { name: '운영 메뉴' })
    .getByRole('link', { name: '작업 큐' })
    .click();
  const job = page.getByRole('list', { name: '작업 목록' }).getByRole('listitem').filter({
    hasText: deadKind,
  });
  await expect(job).toContainText('simulated failure');
  await job.getByRole('button', { name: '재시도' }).click();
  await expect(job).toHaveCount(0);

  // Rights: removal is refused while a grant is suspended, allowed once revoked.
  await page
    .getByRole('navigation', { name: '운영 메뉴' })
    .getByRole('link', { name: '카탈로그 권리' })
    .click();
  await page.getByLabel('곡 ID').fill(lantern);
  await page.getByRole('button', { name: '권리 조회' }).click();
  const grants = page.getByRole('list', { name: '권리 목록' }).getByRole('listitem');
  await expect(grants).toHaveCount(1);
  await grants.first().getByRole('button', { name: '일시 중지' }).click();
  await expect(grants.first()).toContainText('suspended');
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '음원 삭제' }).click();
  await expect(page.getByRole('status')).toContainText('INVALID_STATE');
  await grants.first().getByRole('button', { name: '취소' }).click();
  await expect(grants.first()).toContainText('revoked');
  await page.getByRole('button', { name: '음원 삭제' }).click();
  await expect(page.getByRole('status')).toContainText('음원 삭제: 완료');
  await page.getByRole('link', { name: '곡 화면 보기' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Paper Lantern' })).toBeVisible();
  await expect(page.getByText('음원 없음')).toBeVisible();
});
