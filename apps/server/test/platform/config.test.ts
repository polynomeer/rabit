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
});
