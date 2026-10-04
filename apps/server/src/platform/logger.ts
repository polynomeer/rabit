import { pino, type Logger } from 'pino';

/**
 * Paths never written to logs (ADR-0013, NFR-OBS-002): credentials, signed URLs,
 * user-authored text and file names. IDs are logged instead.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  'authorization',
  'token',
  'access_token',
  'media_token',
  'upload_url',
  'manifest_url',
  'download_url',
  'url',
  'filename',
  'title',
  'note',
  'details',
  'transcript',
  'secret',
  'password',
  '*.authorization',
  '*.token',
  '*.access_token',
  '*.media_token',
  '*.upload_url',
  '*.manifest_url',
  '*.download_url',
  '*.filename',
  '*.title',
  '*.note',
  '*.transcript',
  '*.secret',
];

export function createLogger(options: { level: string; name: string }): Logger {
  return pino({
    name: options.name,
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'rabit', role: options.name },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      // Log the route template, never raw URLs that may carry media tokens or cursors.
      req: (req: { method?: string; routeOptions?: { url?: string }; id?: string }) => ({
        method: req.method,
        route: req.routeOptions?.url,
        request_id: req.id,
      }),
      res: (res: { statusCode?: number }) => ({ status: res.statusCode }),
      err: pino.stdSerializers.err,
    },
  });
}

export type { Logger };
