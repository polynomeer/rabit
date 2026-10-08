import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/platform/config.js';

const base = { ...process.env };

describe('config', () => {
  it('loads the test environment', () => {
    const cfg = loadConfig(base);
    expect(cfg.env).toBe('test');
    expect(cfg.auth.devIssuerEnabled).toBe(true);
  });

  it('refuses the dev issuer in production (T03)', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_ISSUER_ENABLED: 'true' }),
    ).toThrow(/AUTH_DEV_ISSUER_ENABLED/);
  });

  it('refuses disabled rate limits in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_DEV_ISSUER_ENABLED: 'false',
        AUTH_JWKS_URL: 'https://idp.example/jwks',
        RATE_LIMIT_ENABLED: 'false',
      }),
    ).toThrow(/RATE_LIMIT_ENABLED/);
  });

  it('refuses per-process rate-limit counters in production (R13)', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_DEV_ISSUER_ENABLED: 'false',
        AUTH_JWKS_URL: 'https://idp.example/jwks',
        RATE_LIMIT_STORE: 'memory',
      }),
    ).toThrow(/RATE_LIMIT_STORE/);
  });

  it('requires a JWKS URL when the dev issuer is disabled', () => {
    expect(() =>
      loadConfig({ ...base, AUTH_DEV_ISSUER_ENABLED: 'false', AUTH_JWKS_URL: '' }),
    ).toThrow(/AUTH_JWKS_URL/);
  });

  it('rejects short secrets without echoing their values', () => {
    try {
      loadConfig({ ...base, MEDIA_TOKEN_SECRET: 'tooshort-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(String(err)).toContain('MEDIA_TOKEN_SECRET');
      expect(String(err)).not.toContain('tooshort-secret-value');
    }
  });

  it('uses the IAM role when no S3 keys are set, and refuses only one key', () => {
    const roleBased = loadConfig({
      ...base,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });
    expect(roleBased.s3.credentials).toBeUndefined();
    expect(() => loadConfig({ ...base, S3_SECRET_ACCESS_KEY: undefined })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
  });

  it('requires a customer-managed KMS key in production (NFR-SEC-004)', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      AUTH_DEV_ISSUER_ENABLED: 'false',
      AUTH_JWKS_URL: 'https://idp.example/jwks',
      PAYMENTS_PROVIDER: 'none',
    };
    expect(() => loadConfig(prod)).toThrow(/S3_SSE/);
    expect(() => loadConfig({ ...prod, S3_SSE: 'aws:kms' })).toThrow(/S3_SSE_KMS_KEY_ID/);
    const cfg = loadConfig({
      ...prod,
      S3_SSE: 'aws:kms',
      S3_SSE_KMS_KEY_ID: 'arn:aws:kms:ap-northeast-2:111122223333:key/example',
      S3_BUCKET_PREFIX: 'rabit-prod',
    });
    expect(cfg.s3.sse).toEqual({
      mode: 'aws:kms',
      kmsKeyId: 'arn:aws:kms:ap-northeast-2:111122223333:key/example',
    });
    expect(cfg.s3.bucketPrefix).toBe('rabit-prod');
  });

  it('puts a separately injected database password into the URL', () => {
    const cfg = loadConfig({
      ...base,
      DATABASE_URL: 'postgres://rabit@db.example:5432/rabit?sslmode=verify-full',
      DATABASE_PASSWORD: 'p@ss/word:1',
    });
    const u = new URL(cfg.db.url);
    expect(decodeURIComponent(u.password)).toBe('p@ss/word:1');
    expect(u.searchParams.get('sslmode')).toBe('verify-full');
  });
});
