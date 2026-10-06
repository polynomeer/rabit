# ADR-0009: External OIDC; JWT verification via JWKS

- Status: Accepted (approach) / **Proposed (identity provider)**
- Date: 2026-10-04
- Source topic: AP ADR-02 (계정·tenant·key)
- Related: ACC-002, NFR-SEC-002, NFR-SEC-007, NFR-SEC-013, PB §10 (no custom auth)

## Context
Custom authentication is explicitly out (PB §10). The provider choice affects cost and data residency (Playbook §9).

## Options
1. **Any OIDC-compliant provider; API validates RS256/ES256 JWT access tokens against the issuer's JWKS**
2. Session cookies with own password store — rejected (custom auth).

## Decision
- API accepts `Authorization: Bearer <JWT>`. Verification: signature via JWKS (cached, rotated), `iss` equals configured issuer, `aud` equals configured audience, `exp/nbf` with ≤ 60 s clock skew, required `sub`. Email verification claim `email_verified=true` is required to create an account (ACC-002).
- Users are provisioned on first authenticated request keyed by `(issuer, subject)`. A personal workspace is created in the same transaction.
- Ownership (`owner_workspace_id`, `user_id`) is always derived from the verified token, never from request bodies (NFR-SEC-002).
- **Local development and tests** use a built-in development issuer: a key pair generated at startup, a JWKS endpoint, and `POST /dev/token` — enabled only when `NODE_ENV != production` **and** `AUTH_DEV_ISSUER_ENABLED=true`. Startup fails if both production mode and the dev issuer are configured.
- Admin/operator APIs require a separate role claim from the provider plus MFA (`amr` contains `mfa`) — NFR-SEC-007.
- **Proposed**: concrete provider (e.g. Auth0, Cognito, Keycloak self-hosted, Zitadel), MFA policy, account recovery, minors policy (Q01).

## Amendment 2026-10-06: web sign-in, local stand-in, provider requirements
- **Web client:** OIDC Authorization Code flow with PKCE as a public client (no secret), via `oauth4webapi`; ID token nonce and `state` are verified, the code is removed from the address before use, and only the access token is kept (session storage, per tab). When the provider issues a refresh token (kept per tab like the access token), a 401 first renews the access token once — concurrent requests share one renewal and the request is retried; rotated refresh tokens replace the old one. If renewal fails, the user is signed out. Configured with `VITE_OIDC_ISSUER` / `VITE_OIDC_CLIENT_ID`; without them the development sign-in is shown. Moving tokens out of the browser (BFF with HttpOnly cookies) stays the revisit trigger below.
- **Stand-in until the provider is chosen:** `navikt/mock-oauth2-server` in Docker (`docker compose --profile oidc`; started by the E2E stack). E2E tests run the full redirect flow against an api that trusts only that issuer, including operator role with and without MFA and a forged callback.
- **What any provider must deliver in the access token** (or be mapped to): `iss`; `aud` containing the API audience; `sub`; `email_verified: true` (ACC-002); for operators `rabit_roles` containing `rabit:operator` and `amr` containing `mfa` (NFR-SEC-007).

| Provider | Fit | Work needed |
|---|---|---|
| Amazon Cognito (Seoul) | Same account and region as ADR-0012, low cost | Access tokens carry `client_id`, not `aud`, and no `email_verified`/`amr`: needs a pre-token-generation trigger (Essentials tier) to add claims, `cognito:groups` → roles mapping, and MFA for operators enforced in a separate user pool or checked in the trigger |
| Keycloak (self-hosted on ECS) | All claims configurable with mappers; data stays in Seoul | Operating a stateful service (its own database, upgrades) |
| Auth0 / Zitadel Cloud | Standard `aud` via the `audience` parameter (`VITE_OIDC_AUDIENCE`), Actions for custom claims | Data outside Korea; per-MAU pricing |

The choice remains with the owner ([owner actions](../plans/owner-actions.md) O-03).

## Revisit trigger
Provider selection; requirement for first-party session cookies on web (BFF pattern).
