import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';
import { createVerifier, OPERATOR_ROLE, type TrustedIssuer } from '../../src/platform/http/auth.js';
import { loadConfig } from '../../src/platform/config.js';

/** Token checks per provider profile (ADR-0009), with keys generated here. */
async function issuer(iss: string, kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const sign = (claims: JWTPayload, opts: { sub?: string; iss?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(opts.sub ?? 'user-1')
      .setIssuer(opts.iss ?? iss)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
  return { iss, keys: createLocalJWKSet({ keys: [jwk] }), sign };
}

const USERS = 'https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_users';
const OPS = 'https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_ops';

async function cognitoSetup() {
  const users = await issuer(USERS, 'u1');
  const ops = await issuer(OPS, 'o1');
  const trusted: TrustedIssuer[] = [
    {
      issuer: USERS,
      audience: 'web-client',
      keys: users.keys,
      profile: 'cognito',
      operators: false,
    },
    { issuer: OPS, audience: 'ops-client', keys: ops.keys, profile: 'cognito', operators: true },
  ];
  return { users, ops, verifier: createVerifier(trusted) };
}

describe('Cognito profile (ADR-0009)', () => {
  it('accepts user-pool access tokens by client_id and never grants roles from them', async () => {
    const { users, verifier } = await cognitoSetup();
    const token = await users.sign({
      token_use: 'access',
      client_id: 'web-client',
      // Neither a forged role claim nor a Cognito group makes a user an operator.
      rabit_roles: [OPERATOR_ROLE],
      'cognito:groups': ['rabit-operators'],
      amr: ['mfa'],
    });
    expect(await verifier.verify(token)).toEqual({
      issuer: USERS,
      subject: 'user-1',
      emailVerified: true,
      roles: [],
      mfa: false,
    });
  });

  it('refuses ID tokens, other app clients and unknown issuers', async () => {
    const { users, verifier } = await cognitoSetup();
    const stranger = await issuer('https://idp.example', 'x1');
    expect(
      await verifier.verify(
        await users.sign({ token_use: 'id', client_id: 'web-client', aud: 'web-client' }),
      ),
    ).toBeNull();
    expect(
      await verifier.verify(await users.sign({ token_use: 'access', client_id: 'other' })),
    ).toBeNull();
    expect(await verifier.verify(await users.sign({ token_use: 'access' }))).toBeNull();
    expect(
      await verifier.verify(await stranger.sign({ token_use: 'access', client_id: 'web-client' })),
    ).toBeNull();
  });

  it('makes operators only from the MFA-enforcing operator pool', async () => {
    const { users, ops, verifier } = await cognitoSetup();
    const op = await ops.sign({ token_use: 'access', client_id: 'ops-client' }, { sub: 'op-1' });
    expect(await verifier.verify(op)).toEqual({
      issuer: OPS,
      subject: 'op-1',
      emailVerified: true,
      roles: [OPERATOR_ROLE],
      mfa: true,
    });
    // The operator pool's client id is checked too.
    expect(
      await verifier.verify(await ops.sign({ token_use: 'access', client_id: 'web-client' })),
    ).toBeNull();
    // A user-pool key cannot mint a token that claims the operator issuer.
    const forged = await users.sign({ token_use: 'access', client_id: 'ops-client' }, { iss: OPS });
    expect(await verifier.verify(forged)).toBeNull();
  });
});

describe('auth configuration', () => {
  const base = { ...process.env };
  it('needs all three operator issuer settings, and a different issuer', () => {
    expect(() => loadConfig({ ...base, AUTH_OPERATOR_ISSUER: OPS })).toThrow(
      /AUTH_OPERATOR_ISSUER/,
    );
    expect(() =>
      loadConfig({
        ...base,
        AUTH_OPERATOR_ISSUER: base['AUTH_ISSUER'],
        AUTH_OPERATOR_JWKS_URL: `${OPS}/.well-known/jwks.json`,
        AUTH_OPERATOR_AUDIENCE: 'ops-client',
      }),
    ).toThrow(/must differ/);
    const cfg = loadConfig({
      ...base,
      AUTH_PROFILE: 'cognito',
      AUTH_OPERATOR_ISSUER: OPS,
      AUTH_OPERATOR_JWKS_URL: `${OPS}/.well-known/jwks.json`,
      AUTH_OPERATOR_AUDIENCE: 'ops-client',
    });
    expect(cfg.auth.profile).toBe('cognito');
    expect(cfg.auth.operator).toEqual({
      issuer: OPS,
      jwksUrl: `${OPS}/.well-known/jwks.json`,
      audience: 'ops-client',
    });
  });
});
