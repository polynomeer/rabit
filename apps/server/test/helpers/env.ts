/**
 * Test environment defaults. Every value can be overridden by the real environment
 * (CI sets DATABASE_URL and S3_* to its service containers).
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_PUBLIC_BASE_URL: 'http://localhost:8080',
  MEDIA_PUBLIC_BASE_URL: 'http://localhost:8081',
  DATABASE_URL: 'postgres://rabit:rabit@127.0.0.1:55440/rabit_test',
  S3_ENDPOINT: 'http://127.0.0.1:59000',
  S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:59000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'rabit',
  S3_SECRET_ACCESS_KEY: 'rabit-dev-secret',
  S3_FORCE_PATH_STYLE: 'true',
  AUTH_ISSUER: 'http://localhost:8080/dev',
  AUTH_AUDIENCE: 'rabit-api',
  AUTH_DEV_ISSUER_ENABLED: 'true',
  MEDIA_TOKEN_SECRET: 'test-media-token-secret-0123456789abcdef0123',
  CURSOR_SECRET: 'test-cursor-secret-0123456789abcdef0123456789',
  WORKER_CONCURRENCY: '2',
  PAYMENTS_PROVIDER: 'mock',
  PAYMENTS_MOCK_WEBHOOK_SECRET: 'test-mock-pay-webhook-secret-0123456789abcd',
};

for (const [k, v] of Object.entries(defaults)) {
  process.env[k] ??= v;
}
