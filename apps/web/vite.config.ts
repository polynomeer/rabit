import { defineConfig } from 'vite';

// Web reference client (ADR-0011). Talks only to the public API and media gateway.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  server: { port: 5173, strictPort: true },
  // hls.js is a lazily loaded chunk (~575 kB); the entry bundle stays small.
  build: { chunkSizeWarningLimit: 600 },
});
