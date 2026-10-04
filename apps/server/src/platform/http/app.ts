import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import { AppError, errors } from '../errors.js';
import { ulid } from '../ids.js';
import { metrics, statusClass } from '../metrics.js';
import type { TokenVerifier, VerifiedToken } from './auth.js';
import type { Principal } from './principal.js';
import { postgresRateLimitStore } from './rate-limit-store.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface HttpAppOptions {
  service: 'api' | 'media';
  config: Config;
  log: Logger;
  /** Readiness checks: name → async check that throws when unhealthy. */
  readiness: Record<string, () => Promise<void>>;
}

export interface ApiAuthOptions {
  verifier: TokenVerifier;
  /** Maps verified claims to a principal (creates the account on first login). */
  resolvePrincipal(token: VerifiedToken, requestId: string): Promise<Principal>;
  /** Holds the shared rate-limit counters (ADR-0020). */
  db: Db;
}

const ROUTES = new WeakMap<FastifyInstance, { method: string; url: string }[]>();

/** Routes registered on an app (for contract tests against the OpenAPI spec). */
export function registeredRoutes(app: FastifyInstance): { method: string; url: string }[] {
  return ROUTES.get(app) ?? [];
}

function errorBody(err: AppError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      request_id: requestId,
      retryable: err.retryable,
      ...(err.options.details ? { details: err.options.details } : {}),
    },
  };
}

/** Base Fastify app: request IDs, error envelope, metrics, security headers, health. */
export function createHttpApp(opts: HttpAppOptions): FastifyInstance {
  // Widen to Fastify's logger interface so the instance type matches FastifyInstance.
  const logger: FastifyBaseLogger = opts.log;
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024,
    // Media tokens are path parameters (ADR-0008) and exceed the 100-char default.
    routerOptions: { maxParamLength: 1024 },
    trustProxy: false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      const v = Array.isArray(h) ? h[0] : h;
      return v && REQUEST_ID.test(v) ? v : `req_${ulid()}`;
    },
  });

  app.decorateRequest('principal', null);

  const routes: { method: string; url: string }[] = [];
  ROUTES.set(app, routes);
  app.addHook('onRoute', (r) => {
    for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
      if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    metrics.httpRequestDuration.observe(
      {
        service: opts.service,
        method: req.method,
        route: req.routeOptions.url ?? 'unmatched',
        status_class: statusClass(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.setErrorHandler((err, req, reply) => {
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else {
      const e = err as { statusCode?: number; code?: string };
      if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        appErr = errors.payloadTooLarge('PAYLOAD_TOO_LARGE', 'Request body is too large.');
      } else if (e.statusCode === 429) {
        appErr = new AppError(429, 'RATE_LIMITED', 'Too many requests.', { retryable: true });
      } else if (e.statusCode === 415) {
        appErr = errors.validation({ content_type: 'unsupported' }, 'Unsupported content type.');
      } else if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) {
        appErr = errors.validation({ reason: e.code ?? 'bad_request' }, 'Malformed request.');
      } else {
        req.log.error({ err }, 'unhandled error');
        appErr = new AppError(500, 'INTERNAL', 'An unexpected error occurred.', {
          retryable: true,
        });
      }
    }
    if (appErr.status >= 500 && err instanceof AppError) req.log.error({ err }, 'server error');
    void reply.status(appErr.status).send(errorBody(appErr, req.id));
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send(errorBody(errors.notFound(), req.id));
  });

  app.get('/healthz', () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, string> = {};
    let ok = true;
    for (const [name, check] of Object.entries(opts.readiness)) {
      try {
        await check();
        checks[name] = 'ok';
      } catch {
        checks[name] = 'down';
        ok = false;
      }
    }
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'down', checks });
  });

  return app;
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(h);
  return m?.[1] ?? null;
}

/**
 * Adds authentication for `/v1` routes, CORS and per-principal rate limiting.
 * Every `/v1` request must carry a valid bearer token (no anonymous API in MVP).
 */
export async function installApiAuth(
  app: FastifyInstance,
  cfg: Config,
  auth: ApiAuthOptions,
): Promise<void> {
  await app.register(cors, {
    origin: cfg.http.corsAllowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'if-match',
      'x-request-id',
    ],
    exposedHeaders: ['etag', 'x-request-id', 'retry-after'],
    maxAge: 600,
  });

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/v1/')) return;
    const token = bearer(req);
    if (!token) throw errors.unauthenticated();
    const verified = await auth.verifier.verify(token);
    if (!verified) throw errors.unauthenticated();
    if (!verified.emailVerified) throw errors.forbidden('A verified email address is required.');
    const principal = await auth.resolvePrincipal(verified, req.id);
    if (
      principal.status === 'deletion_requested' &&
      !(req.method === 'GET' && req.url === '/v1/me')
    ) {
      throw errors.accountDeletionPending();
    }
    req.principal = principal;
  });

  await installRateLimit(app, cfg, auth.db);
}

/** Per-principal rate limiting for `/v1` (api-guidelines §8); runs after authentication. */
export async function installRateLimit(app: FastifyInstance, cfg: Config, db: Db): Promise<void> {
  if (!cfg.rateLimit.enabled) return;
  await app.register(rateLimit, {
    // Shared counters (ADR-0020). If the store fails, requests pass (fail-open):
    // the database also serves the request itself, and the failure is counted.
    ...(cfg.rateLimit.store === 'postgres'
      ? {
          store: postgresRateLimitStore(db, (err) => {
            // The plugin swallows store errors under skipOnError; record them here.
            metrics.rateLimitStoreErrors.inc();
            app.log.error({ err }, 'rate-limit store failed; request allowed');
          }),
        }
      : {}),
    skipOnError: true,
    global: true,
    hook: 'preHandler',
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.principal?.userId ?? req.ip,
    allowList: (req) => !req.url.startsWith('/v1/'),
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new AppError(429, 'RATE_LIMITED', 'Too many requests.', { retryable: true }), {
        statusCode: 429,
        retryAfter: ctx.after,
      }),
  });
}

/** Per-route rate limit config (api-guidelines §8). */
export function routeLimit(max: number, timeWindow: string) {
  return { config: { rateLimit: { max, timeWindow } } };
}
