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

## Revisit trigger
Provider selection; requirement for first-party session cookies on web (BFF pattern).
