import { expect, test, type Page } from '@playwright/test';
import { E2E } from './config.ts';
import { subjectFor } from './support.ts';

/**
 * Sign-in through an OIDC provider (ADR-0009): Authorization Code + PKCE against a
 * mock provider, with an api that trusts only that provider (no dev issuer).
 */
async function signInWithProvider(page: Page, subject: string, claims?: object) {
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((url) => url.href.startsWith(E2E.oidcIssuer));
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
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('rabit.refresh'))).toBeNull();
});

test('the operator console needs the role and MFA from the provider', async ({ page }) => {
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  await page.goto(E2E.oidcWebUrl);
  await signInWithProvider(page, subjectFor('oidc-op-nomfa'), {
    rabit_roles: ['rabit:operator'],
    amr: ['pwd'],
  });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Ops' })).toHaveCount(0);
  await page.getByRole('button', { name: '로그아웃' }).click();

  await signInWithProvider(page, subjectFor('oidc-op'), {
    rabit_roles: ['rabit:operator'],
    amr: ['pwd', 'mfa'],
  });
  await expect(menu.getByRole('button', { name: 'Ops' })).toBeVisible();
});

test('a callback that this tab did not start is refused', async ({ page }) => {
  await page.goto(`${E2E.oidcWebUrl}/?code=stolen&state=forged`);
  await expect(page.getByText(/로그인하지 못했습니다/)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toHaveCount(0);
});
