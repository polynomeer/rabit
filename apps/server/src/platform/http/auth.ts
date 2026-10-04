import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
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

function toVerified(payload: JWTPayload, issuer: string): VerifiedToken | null {
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
    return null;
  }
  const rolesClaim = payload['rabit_roles'];
  const amr = payload['amr'];
  return {
    issuer,
    subject: payload.sub,
    emailVerified: payload['email_verified'] === true,
    roles: Array.isArray(rolesClaim)
      ? rolesClaim.filter((r): r is string => typeof r === 'string')
      : [],
    mfa: Array.isArray(amr) && amr.includes('mfa'),
  };
}

export function createVerifier(cfg: Config['auth'], keys: JWTVerifyGetKey): TokenVerifier {
  return {
    async verify(token: string) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: cfg.issuer,
          audience: cfg.audience,
          algorithms: ALLOWED_ALGS,
          clockTolerance: 60,
          requiredClaims: ['sub', 'exp'],
        });
        return toVerified(payload, cfg.issuer);
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
