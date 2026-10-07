/**
 * Sign-in with the OIDC provider (ADR-0009): Authorization Code flow with PKCE for a
 * public browser client — no client secret, the code is useless without the
 * verifier kept in this tab. Provider-neutral: each issuer is discovered from
 * `${issuer}/.well-known/openid-configuration`.
 *
 * Two realms: users (VITE_OIDC_ISSUER, VITE_OIDC_CLIENT_ID) and, optionally,
 * operators (VITE_OIDC_OPERATOR_ISSUER, VITE_OIDC_OPERATOR_CLIENT_ID), whose
 * provider enforces MFA (on Cognito: a separate user pool). VITE_OIDC_SCOPE and
 * VITE_OIDC_AUDIENCE are optional. Without a user realm the app shows the
 * development sign-in.
 */
import * as oauth from 'oauth4webapi';
import { REFRESH_KEY, setToken, setTokenRefresher } from './api';

export type Realm = 'user' | 'operator';

const env = import.meta.env as Record<string, string | undefined>;
const realms: Record<Realm, { issuer?: string | undefined; clientId?: string | undefined }> = {
  user: { issuer: env['VITE_OIDC_ISSUER'], clientId: env['VITE_OIDC_CLIENT_ID'] },
  operator: {
    issuer: env['VITE_OIDC_OPERATOR_ISSUER'],
    clientId: env['VITE_OIDC_OPERATOR_CLIENT_ID'],
  },
};
const scope = env['VITE_OIDC_SCOPE'] ?? 'openid email';
const audience = env['VITE_OIDC_AUDIENCE'];

const configured = (r: Realm) => Boolean(realms[r].issuer && realms[r].clientId);
export const oidcEnabled = configured('user');
export const operatorSignInEnabled = oidcEnabled && configured('operator');

const PENDING = 'rabit.oidc.pending';
/** Which realm issued the stored tokens (refresh goes back to the same one). */
export const REALM_KEY = 'rabit.oidc.realm';

interface Pending {
  realm: Realm;
  verifier: string;
  state: string;
  nonce: string;
  /** The hash route to return to after sign-in. */
  returnTo: string;
}

/** The redirect URI is the app's own address without query or hash (hash routes). */
const redirectUri = () => `${location.origin}${location.pathname}`;

function issuerUrl(r: Realm): URL {
  const issuer = realms[r].issuer;
  if (!issuer || !realms[r].clientId) throw new Error('OIDC is not configured');
  return new URL(issuer);
}

/**
 * Plain HTTP is accepted only for a provider on this machine (the local mock).
 * The library marks the option deprecated on purpose, so that every use stands out.
 */
/* eslint-disable @typescript-eslint/no-deprecated */
function httpOptions(url: URL): { [oauth.allowInsecureRequests]?: true } {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    ? { [oauth.allowInsecureRequests]: true }
    : {};
}
/* eslint-enable @typescript-eslint/no-deprecated */

async function authorizationServer(r: Realm): Promise<oauth.AuthorizationServer> {
  const url = issuerUrl(r);
  const res = await oauth.discoveryRequest(url, { algorithm: 'oidc', ...httpOptions(url) });
  return oauth.processDiscoveryResponse(url, res);
}

const client = (r: Realm): oauth.Client => ({ client_id: realms[r].clientId ?? '' });

/** Sends the browser to the provider's sign-in page. */
export async function startSignIn(realm: Realm = 'user'): Promise<void> {
  const as = await authorizationServer(realm);
  if (!as.authorization_endpoint) throw new Error('provider has no authorization endpoint');
  const pending: Pending = {
    realm,
    verifier: oauth.generateRandomCodeVerifier(),
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    returnTo: location.hash,
  };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set('client_id', client(realm).client_id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (audience && realm === 'user') url.searchParams.set('audience', audience);
  location.assign(url.toString());
}

/**
 * Finishes a sign-in when the provider redirected back with `code` and `state`.
 * Returns true when a token was stored. The URL is cleaned either way, so a
 * reload never replays the code.
 */
export async function completeSignIn(): Promise<boolean> {
  const current = new URL(location.href);
  if (!oidcEnabled || (!current.searchParams.has('code') && !current.searchParams.has('error'))) {
    return false;
  }
  const raw = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  const pending = raw ? (JSON.parse(raw) as Pending) : null;
  history.replaceState(null, '', `${redirectUri()}${pending?.returnTo ?? ''}`);
  if (!pending) throw new Error('sign-in was not started in this tab');

  const realm = pending.realm;
  const as = await authorizationServer(realm);
  const params = oauth.validateAuthResponse(as, client(realm), current, pending.state);
  const res = await oauth.authorizationCodeGrantRequest(
    as,
    client(realm),
    oauth.None(),
    params,
    redirectUri(),
    pending.verifier,
    httpOptions(issuerUrl(realm)),
  );
  const result = await oauth.processAuthorizationCodeResponse(as, client(realm), res, {
    expectedNonce: pending.nonce,
    requireIdToken: true,
  });
  setToken(result.access_token);
  sessionStorage.setItem(REALM_KEY, realm);
  storeRefreshToken(result.refresh_token);
  return true;
}

function storeRefreshToken(value: string | undefined): void {
  if (value) sessionStorage.setItem(REFRESH_KEY, value);
}

/**
 * Renews the access token with the refresh token, if the provider issued one, at
 * the realm that issued it. Providers that rotate refresh tokens return a new
 * one, which replaces the old.
 */
async function refreshSession(): Promise<boolean> {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  const realm: Realm = sessionStorage.getItem(REALM_KEY) === 'operator' ? 'operator' : 'user';
  if (!configured(realm) || !refreshToken) return false;
  const as = await authorizationServer(realm);
  const res = await oauth.refreshTokenGrantRequest(
    as,
    client(realm),
    oauth.None(),
    refreshToken,
    httpOptions(issuerUrl(realm)),
  );
  const result = await oauth.processRefreshTokenResponse(as, client(realm), res);
  setToken(result.access_token);
  storeRefreshToken(result.refresh_token);
  return true;
}

if (oidcEnabled) setTokenRefresher(refreshSession);
