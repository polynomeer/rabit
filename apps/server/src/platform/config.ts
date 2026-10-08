import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const secret = z.string().min(32, 'must be at least 32 characters');
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    API_PORT: port.default(8080),
    MEDIA_PORT: port.default(8081),
    METRICS_PORT: port.default(9464),
    API_PUBLIC_BASE_URL: z.url(),
    MEDIA_PUBLIC_BASE_URL: z.url(),
    /** Comma-separated browser origins allowed by CORS (web reference client). */
    CORS_ALLOWED_ORIGINS: z.string().default(''),

    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_POOL_MAX: positiveInt.default(10),
    /**
     * Password injected separately from DATABASE_URL, e.g. from the RDS-managed secret
     * in Secrets Manager, so the URL itself holds no secret. Overrides a URL password.
     */
    DATABASE_PASSWORD: z.string().min(1).optional(),

    S3_ENDPOINT: z.url().optional(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    /** Static keys for local S3 servers. Leave both unset on AWS to use the task's IAM role. */
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    /**
     * Physical bucket names are `<prefix>-quarantine`, `<prefix>-private-media`, …
     * (ADR-0004); S3 bucket names are global, so each environment sets its own.
     */
    S3_BUCKET_PREFIX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/)
      .default('rabit'),
    /** Server-side encryption on every write: `aws:kms` with a customer key in production (NFR-SEC-004). */
    S3_SSE: z.enum(['AES256', 'aws:kms']).default('AES256'),
    S3_SSE_KMS_KEY_ID: z.string().min(1).optional(),

    AUTH_ISSUER: z.url(),
    AUTH_AUDIENCE: z.string().min(1),
    AUTH_JWKS_URL: z.union([z.url(), z.literal('')]).optional(),
    AUTH_DEV_ISSUER_ENABLED: bool.default(false),
    /**
     * How the provider's access tokens carry the audience and email state (ADR-0009):
     * `standard` checks `aud` and `email_verified`; `cognito` checks `client_id` and
     * `token_use=access`, and relies on the user pool allowing sign-in only after
     * email verification.
     */
    AUTH_PROFILE: z.enum(['standard', 'cognito']).default('standard'),
    /**
     * Separate issuer for operators whose provider enforces MFA for every sign-in
     * (e.g. a Cognito user pool with MFA required). Its tokens are operators with
     * MFA; tokens from AUTH_ISSUER never are when the profile is `cognito`.
     */
    AUTH_OPERATOR_ISSUER: z.url().optional(),
    AUTH_OPERATOR_JWKS_URL: z.url().optional(),
    AUTH_OPERATOR_AUDIENCE: z.string().min(1).optional(),

    MEDIA_TOKEN_SECRET: secret,
    CURSOR_SECRET: secret,

    /** Per-user API rate limits (api-guidelines §8). Disabling is allowed only outside production (benchmarks). */
    RATE_LIMIT_ENABLED: bool.default(true),
    /**
     * Where counters live (ADR-0020): `postgres` is shared by every api instance;
     * `memory` is per process and refused in production.
     */
    RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).default('postgres'),

    /**
     * Payment provider for album purchase (ADR-0018, provisional). `none` turns
     * checkout off; `mock` is the sandbox provider with signed webhooks, refused in
     * production until a real provider is decided (Q04).
     */
    PAYMENTS_PROVIDER: z.enum(['none', 'mock']).default('none'),
    PAYMENTS_MOCK_WEBHOOK_SECRET: secret.optional(),

    WORKER_CONCURRENCY: positiveInt.default(2),
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().min(1).default('ffprobe'),

    // Plan policy placeholders (Q03). Values are configuration, not product promises.
    QUOTA_FREE_MAX_TOTAL_BYTES: positiveInt.default(5 * 1024 ** 3),
    QUOTA_FREE_MAX_FILE_BYTES: positiveInt.default(500 * 1024 ** 2),
    QUOTA_FREE_MAX_DURATION_MS: positiveInt.default(3 * 60 * 60 * 1000),
    QUOTA_FREE_MAX_CONCURRENT_UPLOADS: positiveInt.default(3),
  })
  .superRefine((c, ctx) => {
    // ADR-0009 / T03: the development issuer must never run in production.
    if (c.NODE_ENV === 'production' && c.AUTH_DEV_ISSUER_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_ISSUER_ENABLED'],
        message: 'must be false when NODE_ENV=production',
      });
    }
    if (c.NODE_ENV === 'production' && c.PAYMENTS_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_PROVIDER'],
        message: 'must not be mock when NODE_ENV=production',
      });
    }
    if (c.PAYMENTS_PROVIDER === 'mock' && !c.PAYMENTS_MOCK_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_MOCK_WEBHOOK_SECRET'],
        message: 'is required when PAYMENTS_PROVIDER=mock',
      });
    }
    if (c.NODE_ENV === 'production' && !c.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'must be true when NODE_ENV=production',
      });
    }
    if (c.NODE_ENV === 'production' && c.RATE_LIMIT_STORE !== 'postgres') {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_STORE'],
        message: 'must be postgres when NODE_ENV=production (limits shared by every instance)',
      });
    }
    if ((c.S3_ACCESS_KEY_ID === undefined) !== (c.S3_SECRET_ACCESS_KEY === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'set both S3 keys, or neither to use the IAM role',
      });
    }
    if (c.S3_SSE === 'aws:kms' && !c.S3_SSE_KMS_KEY_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SSE_KMS_KEY_ID'],
        message: 'is required when S3_SSE=aws:kms',
      });
    }
    if (c.NODE_ENV === 'production' && c.S3_SSE !== 'aws:kms') {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SSE'],
        message: 'must be aws:kms when NODE_ENV=production (customer-managed key, NFR-SEC-004)',
      });
    }
    const operatorSet = [
      c.AUTH_OPERATOR_ISSUER,
      c.AUTH_OPERATOR_JWKS_URL,
      c.AUTH_OPERATOR_AUDIENCE,
    ];
    if (operatorSet.some((v) => v !== undefined) && operatorSet.some((v) => v === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_OPERATOR_ISSUER'],
        message:
          'set AUTH_OPERATOR_ISSUER, AUTH_OPERATOR_JWKS_URL and AUTH_OPERATOR_AUDIENCE together',
      });
    }
    if (c.AUTH_OPERATOR_ISSUER && c.AUTH_OPERATOR_ISSUER === c.AUTH_ISSUER) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_OPERATOR_ISSUER'],
        message: 'must differ from AUTH_ISSUER',
      });
    }
    if (!c.AUTH_DEV_ISSUER_ENABLED && !c.AUTH_JWKS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_JWKS_URL'],
        message: 'is required unless the development issuer is enabled',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  logLevel: Env['LOG_LEVEL'];
  http: {
    apiPort: number;
    mediaPort: number;
    metricsPort: number;
    apiPublicBaseUrl: string;
    mediaPublicBaseUrl: string;
    corsAllowedOrigins: string[];
  };
  db: { url: string; poolMax: number };
  s3: {
    endpoint: string | undefined;
    publicEndpoint: string | undefined;
    region: string;
    /** Undefined: the default AWS credential chain (IAM role on ECS). */
    credentials: { accessKeyId: string; secretAccessKey: string } | undefined;
    forcePathStyle: boolean;
    bucketPrefix: string;
    sse: { mode: 'AES256' } | { mode: 'aws:kms'; kmsKeyId: string };
  };
  auth: {
    issuer: string;
    audience: string;
    jwksUrl: string | undefined;
    devIssuerEnabled: boolean;
    profile: 'standard' | 'cognito';
    operator: { issuer: string; jwksUrl: string; audience: string } | undefined;
  };
  secrets: { mediaToken: string; cursor: string };
  rateLimit: { enabled: boolean; store: 'postgres' | 'memory' };
  payments: { provider: 'none' } | { provider: 'mock'; webhookSecret: string };
  worker: { concurrency: number; ffmpegPath: string; ffprobePath: string };
  quota: {
    maxTotalBytes: number;
    maxFileBytes: number;
    maxDurationMs: number;
    maxConcurrentUploads: number;
  };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates the environment. Error messages name the variable and the rule,
 * never the value, so secrets cannot leak into logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    http: {
      apiPort: e.API_PORT,
      mediaPort: e.MEDIA_PORT,
      metricsPort: e.METRICS_PORT,
      apiPublicBaseUrl: e.API_PUBLIC_BASE_URL.replace(/\/$/, ''),
      mediaPublicBaseUrl: e.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, ''),
      corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    },
    db: { url: withPassword(e.DATABASE_URL, e.DATABASE_PASSWORD), poolMax: e.DATABASE_POOL_MAX },
    s3: {
      endpoint: e.S3_ENDPOINT,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT,
      region: e.S3_REGION,
      credentials:
        e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
          : undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      bucketPrefix: e.S3_BUCKET_PREFIX,
      sse:
        e.S3_SSE === 'aws:kms'
          ? { mode: 'aws:kms', kmsKeyId: e.S3_SSE_KMS_KEY_ID ?? '' }
          : { mode: 'AES256' },
    },
    auth: {
      issuer: e.AUTH_ISSUER,
      audience: e.AUTH_AUDIENCE,
      jwksUrl: e.AUTH_JWKS_URL === '' ? undefined : e.AUTH_JWKS_URL,
      devIssuerEnabled: e.AUTH_DEV_ISSUER_ENABLED,
      profile: e.AUTH_PROFILE,
      operator:
        e.AUTH_OPERATOR_ISSUER && e.AUTH_OPERATOR_JWKS_URL && e.AUTH_OPERATOR_AUDIENCE
          ? {
              issuer: e.AUTH_OPERATOR_ISSUER,
              jwksUrl: e.AUTH_OPERATOR_JWKS_URL,
              audience: e.AUTH_OPERATOR_AUDIENCE,
            }
          : undefined,
    },
    secrets: { mediaToken: e.MEDIA_TOKEN_SECRET, cursor: e.CURSOR_SECRET },
    rateLimit: { enabled: e.RATE_LIMIT_ENABLED, store: e.RATE_LIMIT_STORE },
    payments:
      e.PAYMENTS_PROVIDER === 'mock'
        ? { provider: 'mock', webhookSecret: e.PAYMENTS_MOCK_WEBHOOK_SECRET ?? '' }
        : { provider: 'none' },
    worker: {
      concurrency: e.WORKER_CONCURRENCY,
      ffmpegPath: e.FFMPEG_PATH,
      ffprobePath: e.FFPROBE_PATH,
    },
    quota: {
      maxTotalBytes: e.QUOTA_FREE_MAX_TOTAL_BYTES,
      maxFileBytes: e.QUOTA_FREE_MAX_FILE_BYTES,
      maxDurationMs: e.QUOTA_FREE_MAX_DURATION_MS,
      maxConcurrentUploads: e.QUOTA_FREE_MAX_CONCURRENT_UPLOADS,
    },
  };
}

function withPassword(url: string, password: string | undefined): string {
  if (password === undefined) return url;
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}
