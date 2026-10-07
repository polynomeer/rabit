import { expect, test, type Page } from '@playwright/test';
import { E2E } from './config.ts';
import { subjectFor } from './support.ts';

/**
 * Sign-in through an OIDC provider (ADR-0009): Authorization Code + PKCE against a
 * mock provider, with an api that trusts only that provider (no dev issuer).
 */
async function signInWithProvider(
  page: Page,
  subject: string,
  claims?: object,
  realm: 'user' | 'operator' = 'user',
) {
  const button = realm === 'user' ? '로그인' : '운영자 로그인 (MFA)';
  await page.getByRole('button', { name: button, exact: true }).click();
  const issuer = realm === 'user' ? E2E.oidcIssuer : E2E.oidcOperatorIssuer;
  await page.waitForURL((url) => url.href.startsWith(`${issuer}/`));
  await page.locator('input[name="username"]').fill(subject);
  if (claims) await page.locator('textarea[name="claims"]').fill(JSON.stringify(claims));
  await page.getByRole('button', { name: 'Sign-in' }).click();
}

test('signs in through the provider and returns to the requested screen', async ({ page }) => {
  const subject = subjectFor('oidc');
  await page.goto(`${E2E.oidcWebUrl}/#/account`);
  // No development sign-in when a provider is configured.
  await expect(page.getByLabel('개발용 로그인 ID')).toHaveCount(0);
  await signInWithProvider(page, subject);

  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/account');
  // The code is gone from the address: a reload cannot replay it.
  expect(new URL(page.url()).search).toBe('');
  await expect(
    page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: 'Ops' }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();

  // An access token the API no longer accepts is renewed with the refresh token.
  expect(await page.evaluate(() => sessionStorage.getItem('rabit.refresh'))).toBeTruthy();
  await page.evaluate(() => {
    sessionStorage.setItem('rabit.token', 'expired.or.revoked');
  });
  const refreshed = page.waitForResponse(
    (r) =>
      r.url().endsWith('/token') &&
      r.request().postData()?.includes('grant_type=refresh_token') === true,
  );
  await page.reload();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('rabit.token'))).not.toBe(
    'expired.or.revoked',
  );

  // Without a usable refresh token the user is signed out instead of failing every call.
  await page.evaluate(() => {
    sessionStorage.setItem('rabit.token', 'expired.or.revoked');
    sessionStorage.setItem('rabit.refresh', 'revoked');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('rabit.refresh'))).toBeNull();
});

test('only the MFA operator pool opens the operator console, never user-pool claims', async ({
  page,
}) => {
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  await page.goto(E2E.oidcWebUrl);
  // A user-pool token with forged role, group and MFA claims stays a user (ADR-0009).
  await signInWithProvider(page, subjectFor('oidc-forged'), {
    rabit_roles: ['rabit:operator'],
    'cognito:groups': ['rabit-operators'],
    amr: ['pwd', 'mfa'],
  });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Ops' })).toHaveCount(0);
  await page.getByRole('button', { name: '로그아웃' }).click();

  await signInWithProvider(page, subjectFor('oidc-op'), undefined, 'operator');
  await expect(menu.getByRole('button', { name: 'Ops' })).toBeVisible();
  await menu.getByRole('button', { name: 'Ops' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '운영' })).toBeVisible();
});

test('a callback that this tab did not start is refused', async ({ page }) => {
  await page.goto(`${E2E.oidcWebUrl}/?code=stolen&state=forged`);
  await expect(page.getByText(/로그인하지 못했습니다/)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toHaveCount(0);
});
