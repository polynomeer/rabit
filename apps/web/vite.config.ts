import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { contentSecurityPolicy } from './csp';

// `vite preview` sends the production CSP when its origins are given (E2E stack).
const cspEnv = process.env['RABIT_CSP_API'];
const previewHeaders = cspEnv
  ? {
      'content-security-policy': contentSecurityPolicy({
        api: cspEnv,
        media: process.env['RABIT_CSP_MEDIA'] ?? cspEnv,
        oidc: process.env['RABIT_CSP_OIDC'] ?? cspEnv,
        upload: process.env['RABIT_CSP_UPLOAD'] ?? cspEnv,
      }),
    }
  : {};

// The version client diagnostics report (ADR-0027): package version + commit.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};
const commit = (process.env['GITHUB_SHA'] ?? 'dev').slice(0, 7);
const appVersion = `${pkg.version ?? '0.0.0'}+${commit}`;

// Web reference client (ADR-0011). Talks only to the public API and media gateway.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  server: { port: 5173, strictPort: true },
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
  // hls.js is a lazily loaded chunk (~575 kB); the entry bundle stays small.
  // Source maps are written but not linked from the bundles: they map reported stack
  // frames back to the source and are never published (publish-web.sh).
  build: { chunkSizeWarningLimit: 600, sourcemap: 'hidden' },
  preview: { headers: previewHeaders },
});
