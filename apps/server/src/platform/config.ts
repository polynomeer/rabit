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

    S3_ENDPOINT: z.url().optional(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),

    AUTH_ISSUER: z.url(),
    AUTH_AUDIENCE: z.string().min(1),
    AUTH_JWKS_URL: z.union([z.url(), z.literal('')]).optional(),
    AUTH_DEV_ISSUER_ENABLED: bool.default(false),

    MEDIA_TOKEN_SECRET: secret,
    CURSOR_SECRET: secret,

    /** Per-user API rate limits (api-guidelines §8). Disabling is allowed only outside production (benchmarks). */
    RATE_LIMIT_ENABLED: bool.default(true),

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
    if (c.NODE_ENV === 'production' && !c.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'must be true when NODE_ENV=production',
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
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  auth: {
    issuer: string;
    audience: string;
    jwksUrl: string | undefined;
    devIssuerEnabled: boolean;
  };
  secrets: { mediaToken: string; cursor: string };
  rateLimit: { enabled: boolean };
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
    db: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    s3: {
      endpoint: e.S3_ENDPOINT,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    auth: {
      issuer: e.AUTH_ISSUER,
      audience: e.AUTH_AUDIENCE,
      jwksUrl: e.AUTH_JWKS_URL === '' ? undefined : e.AUTH_JWKS_URL,
      devIssuerEnabled: e.AUTH_DEV_ISSUER_ENABLED,
    },
    secrets: { mediaToken: e.MEDIA_TOKEN_SECRET, cursor: e.CURSOR_SECRET },
    rateLimit: { enabled: e.RATE_LIMIT_ENABLED },
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
