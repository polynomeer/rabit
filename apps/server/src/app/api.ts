import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createVerifier,
  DevIssuer,
  remoteKeys,
  type VerifiedToken,
} from '../platform/http/auth.js';
import { createHttpApp, installApiAuth } from '../platform/http/app.js';
import type { Principal } from '../platform/http/principal.js';
import { parse } from '../platform/http/validation.js';
import { readinessChecks, type AppContext } from './context.js';
import type { Module } from './modules.js';

export interface ApiApp {
  app: FastifyInstance;
  devIssuer: DevIssuer | null;
}

export async function buildApiApp(
  ctx: AppContext,
  modules: Module[],
  resolvePrincipal: (token: VerifiedToken, requestId: string) => Promise<Principal>,
): Promise<ApiApp> {
  const app = createHttpApp({
    service: 'api',
    config: ctx.config,
    log: ctx.log,
    readiness: readinessChecks(ctx),
  });

  let devIssuer: DevIssuer | null = null;
  let keys;
  if (ctx.config.auth.devIssuerEnabled) {
    devIssuer = await DevIssuer.create(ctx.config.auth, ctx.config.env);
    keys = devIssuer.keys();
    const issuer = devIssuer;
    app.get('/dev/.well-known/jwks.json', () => ({ keys: [issuer.publicJwk] }));
    app.post('/dev/token', async (req) => {
      const body = parse(
        z.strictObject({ subject: z.string().min(1).max(64), operator: z.boolean().optional() }),
        req.body,
      );
      const token = await issuer.issue({ subject: body.subject, operator: body.operator ?? false });
      return { access_token: token, expires_in: 3600 };
    });
    ctx.log.warn('development token issuer is ENABLED (never in production)');
  } else {
    if (!ctx.config.auth.jwksUrl) throw new Error('AUTH_JWKS_URL is required');
    keys = remoteKeys(ctx.config.auth.jwksUrl);
  }

  await installApiAuth(app, ctx.config, {
    verifier: createVerifier(ctx.config.auth, keys),
    resolvePrincipal,
  });

  for (const m of modules) await m.routes?.(app, ctx);
  return { app, devIssuer };
}
