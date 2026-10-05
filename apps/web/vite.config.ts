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

// Web reference client (ADR-0011). Talks only to the public API and media gateway.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  server: { port: 5173, strictPort: true },
  // hls.js is a lazily loaded chunk (~575 kB); the entry bundle stays small.
  build: { chunkSizeWarningLimit: 600 },
  preview: { headers: previewHeaders },
});
