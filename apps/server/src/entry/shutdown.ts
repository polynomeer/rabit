import type { Logger } from '../platform/logger.js';

/** Runs `close` once on SIGTERM/SIGINT; exits non-zero if shutdown fails or hangs. */
export function onShutdown(log: Logger, close: () => Promise<void>, timeoutMs = 20_000): void {
  let closing = false;
  const handler = (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      log.error('shutdown timed out');
      process.exit(1);
    }, timeoutMs);
    close()
      .then(() => {
        clearTimeout(timer);
        process.exit(0);
      })
      .catch((err: unknown) => {
        log.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => {
    handler('SIGTERM');
  });
  process.on('SIGINT', () => {
    handler('SIGINT');
  });
}
