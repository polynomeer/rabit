/**
 * Sign-in with the OIDC provider (ADR-0009): Authorization Code flow with PKCE for a
 * public browser client — no client secret, the code is useless without the
 * verifier kept in this tab. Provider-neutral: the issuer is discovered from
 * `${issuer}/.well-known/openid-configuration`.
 *
 * Configured at build time with VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID (and
 * optionally VITE_OIDC_SCOPE, VITE_OIDC_AUDIENCE for providers that need an API
 * audience parameter). Without them the app shows the development sign-in.
 */
import * as oauth from 'oauth4webapi';
import { REFRESH_KEY, setToken, setTokenRefresher } from './api';

const env = import.meta.env as Record<string, string | undefined>;
const issuer = env['VITE_OIDC_ISSUER'];
const clientId = env['VITE_OIDC_CLIENT_ID'];
const scope = env['VITE_OIDC_SCOPE'] ?? 'openid email';
const audience = env['VITE_OIDC_AUDIENCE'];

export const oidcEnabled = Boolean(issuer && clientId);

const PENDING = 'rabit.oidc.pending';

interface Pending {
  verifier: string;
  state: string;
  nonce: string;
  /** The hash route to return to after sign-in. */
  returnTo: string;
}

/** The redirect URI is the app's own address without query or hash (hash routes). */
const redirectUri = () => `${location.origin}${location.pathname}`;

function issuerUrl(): URL {
  if (!issuer || !clientId) throw new Error('OIDC is not configured');
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

async function authorizationServer(): Promise<oauth.AuthorizationServer> {
  const url = issuerUrl();
  const res = await oauth.discoveryRequest(url, { algorithm: 'oidc', ...httpOptions(url) });
  return oauth.processDiscoveryResponse(url, res);
}

const client = (): oauth.Client => ({ client_id: clientId ?? '' });

/** Sends the browser to the provider's sign-in page. */
export async function startSignIn(): Promise<void> {
  const as = await authorizationServer();
  if (!as.authorization_endpoint) throw new Error('provider has no authorization endpoint');
  const pending: Pending = {
    verifier: oauth.generateRandomCodeVerifier(),
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    returnTo: location.hash,
  };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set('client_id', client().client_id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (audience) url.searchParams.set('audience', audience);
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

  const as = await authorizationServer();
  const params = oauth.validateAuthResponse(as, client(), current, pending.state);
  const res = await oauth.authorizationCodeGrantRequest(
    as,
    client(),
    oauth.None(),
    params,
    redirectUri(),
    pending.verifier,
    httpOptions(issuerUrl()),
  );
  const result = await oauth.processAuthorizationCodeResponse(as, client(), res, {
    expectedNonce: pending.nonce,
    requireIdToken: true,
  });
  setToken(result.access_token);
  storeRefreshToken(result.refresh_token);
  return true;
}

function storeRefreshToken(value: string | undefined): void {
  if (value) sessionStorage.setItem(REFRESH_KEY, value);
}

/**
 * Renews the access token with the refresh token, if the provider issued one.
 * Providers that rotate refresh tokens return a new one, which replaces the old.
 */
async function refreshSession(): Promise<boolean> {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!oidcEnabled || !refreshToken) return false;
  const as = await authorizationServer();
  const res = await oauth.refreshTokenGrantRequest(
    as,
    client(),
    oauth.None(),
    refreshToken,
    httpOptions(issuerUrl()),
  );
  const result = await oauth.processRefreshTokenResponse(as, client(), res);
  setToken(result.access_token);
  storeRefreshToken(result.refresh_token);
  return true;
}

if (oidcEnabled) setTokenRefresher(refreshSession);
