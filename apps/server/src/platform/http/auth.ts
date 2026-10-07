import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { Config } from '../config.js';

/** Verified identity claims. Nothing here comes from the request body. */
export interface VerifiedToken {
  issuer: string;
  subject: string;
  emailVerified: boolean;
  roles: string[];
  mfa: boolean;
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export const OPERATOR_ROLE = 'rabit:operator';
const ALLOWED_ALGS = ['RS256', 'ES256'];

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}

/**
 * One trusted issuer (ADR-0009). `profile` says where the provider puts the
 * audience and the email state; `operators` marks an issuer whose provider
 * enforces MFA on every sign-in and whose users are all operators.
 */
export interface TrustedIssuer {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
  profile: 'standard' | 'cognito';
  operators: boolean;
}

function claimsOf(payload: JWTPayload, t: TrustedIssuer): VerifiedToken | null {
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
    return null;
  }
  if (t.profile === 'cognito') {
    // Cognito access tokens name the app client in `client_id` and have no `aud`;
    // ID tokens (token_use=id) are never accepted as API credentials.
    if (payload['token_use'] !== 'access' || payload['client_id'] !== t.audience) return null;
  }
  if (t.operators) {
    return {
      issuer: t.issuer,
      subject: payload.sub,
      emailVerified: true,
      roles: [OPERATOR_ROLE],
      mfa: true,
    };
  }
  if (t.profile === 'cognito') {
    // The user pool lets users sign in only after verifying their email, and roles
    // never come from this issuer: operators use their own MFA-enforcing pool.
    return { issuer: t.issuer, subject: payload.sub, emailVerified: true, roles: [], mfa: false };
  }
  const rolesClaim = payload['rabit_roles'];
  const amr = payload['amr'];
  return {
    issuer: t.issuer,
    subject: payload.sub,
    emailVerified: payload['email_verified'] === true,
    roles: Array.isArray(rolesClaim)
      ? rolesClaim.filter((r): r is string => typeof r === 'string')
      : [],
    mfa: Array.isArray(amr) && amr.includes('mfa'),
  };
}

/** Accepts tokens only from the listed issuers, each checked with its own keys and rules. */
export function createVerifier(issuers: TrustedIssuer[]): TokenVerifier {
  return {
    async verify(token: string) {
      try {
        // The unverified `iss` only selects which keys to check the signature with.
        const iss = decodeJwt(token).iss;
        const t = issuers.find((i) => i.issuer === iss);
        if (!t) return null;
        const { payload } = await jwtVerify(token, t.keys, {
          issuer: t.issuer,
          ...(t.profile === 'standard' ? { audience: t.audience } : {}),
          algorithms: ALLOWED_ALGS,
          clockTolerance: 60,
          requiredClaims: ['sub', 'exp'],
        });
        return claimsOf(payload, t);
      } catch {
        return null;
      }
    },
  };
}

export function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
}

/**
 * Development issuer (ADR-0009). Generates an in-memory key pair. Construction is
 * refused in production by configuration validation and here as a second guard.
 */
export class DevIssuer {
  private constructor(
    private readonly privateKey: PrivateKey,
    readonly publicJwk: JWK,
    private readonly cfg: Config['auth'],
  ) {}

  static async create(cfg: Config['auth'], env: Config['env']): Promise<DevIssuer> {
    if (env === 'production') throw new Error('Dev issuer cannot be used in production');
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    return new DevIssuer(privateKey, { ...jwk, alg: 'ES256', use: 'sig', kid: 'dev-1' }, cfg);
  }

  keys(): JWTVerifyGetKey {
    return createLocalJWKSet({ keys: [this.publicJwk] });
  }

  async issue(opts: {
    subject: string;
    operator?: boolean;
    /** Operators get MFA in `amr` unless this is false (tests the MFA requirement). */
    mfa?: boolean;
    emailVerified?: boolean;
    ttlSeconds?: number;
    audience?: string;
    expired?: boolean;
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = opts.ttlSeconds ?? 3600;
    const jwt = new SignJWT({
      email_verified: opts.emailVerified ?? true,
      ...(opts.operator
        ? { rabit_roles: [OPERATOR_ROLE], amr: opts.mfa === false ? ['pwd'] : ['pwd', 'mfa'] }
        : { amr: ['pwd'] }),
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'dev-1' })
      .setSubject(opts.subject)
      .setIssuer(this.cfg.issuer)
      .setAudience(opts.audience ?? this.cfg.audience)
      .setIssuedAt(opts.expired ? now - 7200 : now)
      .setExpirationTime(opts.expired ? now - 3600 : now + ttl);
    return jwt.sign(this.privateKey);
  }
}
