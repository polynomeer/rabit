import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { errors } from '../../platform/errors.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  parse,
  requireIfMatch,
} from '../../platform/http/validation.js';
import { PermanentJobError } from '../../platform/jobs/runner.js';
import { metrics } from '../../platform/metrics.js';
import type { SupportSection } from '../../platform/support.js';
import type { AccountDataDeleter } from '../identity/index.js';
import { MOCK_DELIVER_JOB, MOCK_SIGNATURE_HEADER, MockPaymentProvider } from './mock-provider.js';
import { WebhookRejected, type PaymentProvider } from './provider.js';
import {
  APPLY_EVENT_JOB,
  KR_VAT_BP,
  SUBMIT_REFUND_JOB,
  applyEvent,
  cancelOrder,
  cancelPendingOrders,
  createOffer,
  createOrder,
  expireOrders,
  getOrder,
  listOrders,
  offerForRelease,
  opsOrder,
  receiveEvent,
  reconcile,
  requestRefund,
  submitRefund,
  withdrawOffer,
} from './service.js';

export { includedTax, ledgerBalances } from './ledger.js';
export { MockPaymentProvider } from './mock-provider.js';
export { reconcile } from './service.js';

const reason = z.string().min(3).max(500);

/** The configured provider, or null when checkout is off (PAYMENTS_PROVIDER=none). */
export function paymentProvider(ctx: AppContext): PaymentProvider | null {
  const p = ctx.config.payments;
  return p.provider === 'mock'
    ? new MockPaymentProvider(p.webhookSecret, ctx.config.http.apiPublicBaseUrl)
    : null;
}

function requireProvider(provider: PaymentProvider | null): PaymentProvider {
  if (!provider) throw errors.unavailable();
  return provider;
}

async function routes(app: FastifyInstance, ctx: AppContext, provider: PaymentProvider | null) {
  app.get('/v1/releases/:release_id/offer', async (req) => {
    const p = requirePrincipal(req.principal);
    const { release_id } = parse(z.object({ release_id: idOf('release') }), req.params);
    return {
      ...(await offerForRelease(ctx.db, p.userId, release_id)),
      checkout_available: provider !== null,
    };
  });

  app.post('/v1/orders', async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const body = parse(
      z.strictObject({
        offer_id: idOf('offer'),
        confirm_already_owned: z.boolean().default(false),
      }),
      req.body,
    );
    const pp = requireProvider(provider);
    const key = idempotencyKeyFrom(req.headers, true);
    const r = await withIdempotency(
      ctx.db,
      { userId: p.userId, operation: 'order.create', key, request: body },
      () => createOrder(ctx.db, pp, p, body, req.id),
    );
    return reply.status(r.status).header('etag', etag(r.body.version)).send(r.body);
  });

  app.get('/v1/orders', async (req) => {
    const p = requirePrincipal(req.principal);
    return listOrders(ctx.db, p.userId);
  });

  app.get('/v1/orders/:order_id', async (req, reply) => {
    const p = requirePrincipal(req.principal);
    const { order_id } = parse(z.object({ order_id: idOf('order') }), req.params);
    const o = await getOrder(ctx.db, p.userId, order_id);
    return reply.header('etag', etag(o.version)).send(o);
  });

  app.post('/v1/orders/:order_id/cancel', async (req) => {
    const p = requirePrincipal(req.principal);
    const { order_id } = parse(z.object({ order_id: idOf('order') }), req.params);
    return cancelOrder(ctx.db, p, order_id, req.id);
  });

  // ---- operators ----

  app.post('/v1/ops/offers', async (req, reply) => {
    const op = requireOperator(req.principal);
    const body = parse(
      z.strictObject({
        release_id: idOf('release'),
        territories: z
          .array(z.string().regex(/^[A-Z]{2}$/))
          .min(1)
          .max(50),
        price_minor: z.number().int().min(100).max(10_000_000),
        vat_rate_bp: z.number().int().min(0).max(10_000).default(KR_VAT_BP),
        reason,
      }),
      req.body,
    );
    const offer = await createOffer(ctx.db, op, body, req.id);
    return reply.status(201).send(offer);
  });

  app.post('/v1/ops/offers/:offer_id/withdraw', async (req) => {
    const op = requireOperator(req.principal);
    const { offer_id } = parse(z.object({ offer_id: idOf('offer') }), req.params);
    const body = parse(z.strictObject({ reason }), req.body);
    return withdrawOffer(ctx.db, op, offer_id, body.reason, req.id);
  });

  app.get('/v1/ops/orders/:order_id', async (req, reply) => {
    requireOperator(req.principal);
    const { order_id } = parse(z.object({ order_id: idOf('order') }), req.params);
    const o = await opsOrder(ctx.db, order_id);
    return reply.header('etag', etag(o.version)).send(o);
  });

  app.post('/v1/ops/orders/:order_id/refunds', async (req, reply) => {
    const op = requireOperator(req.principal);
    const { order_id } = parse(z.object({ order_id: idOf('order') }), req.params);
    const version = requireIfMatch(req.headers);
    const body = parse(z.strictObject({ reason }), req.body);
    requireProvider(provider);
    const o = await requestRefund(ctx.db, op, order_id, version, body.reason, req.id);
    return reply.status(202).header('etag', etag(o.version)).send(o);
  });

  // ---- provider webhooks: outside /v1 (no user token); the signature authenticates ----
  await app.register((scope, _opts, done) => {
    // The signature covers the exact bytes, so the body is kept as text.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });
    scope.post('/webhooks/payments/:provider', async (req, reply) => {
      const { provider: name } = parse(z.object({ provider: z.string().max(20) }), req.params);
      if (!provider || provider.name !== name) throw errors.notFound();
      const raw = typeof req.body === 'string' ? req.body : '';
      let event;
      try {
        event = provider.verifyWebhook(raw, req.headers);
      } catch (err) {
        if (!(err instanceof WebhookRejected)) throw err;
        metrics.paymentEvents.inc({
          provider: name,
          type: 'unknown',
          outcome: `rejected_${err.reason}`,
        });
        req.log.warn({ reason: err.reason }, 'payment webhook rejected');
        throw errors.validation({ webhook: err.reason }, 'The webhook could not be verified.');
      }
      const outcome = await receiveEvent(ctx.db, provider, event, raw);
      return reply.status(200).send({ received: true, duplicate: outcome === 'duplicate' });
    });
    done();
  });

  // ---- the mock provider's "hosted checkout" (never in production: config) ----
  if (provider instanceof MockPaymentProvider) {
    const mock = provider;
    const refParam = z.object({ checkout_ref: z.string().regex(/^mck_[0-9a-f]{24}$/) });
    app.get('/dev/mock-pay/checkouts/:checkout_ref', async (req) => {
      const { checkout_ref } = parse(refParam, req.params);
      const c = await mock.checkout(ctx.db, checkout_ref);
      if (!c) throw errors.notFound();
      return { ...c, provider: 'mock', signature_header: MOCK_SIGNATURE_HEADER };
    });
    app.post('/dev/mock-pay/checkouts/:checkout_ref/complete', async (req, reply) => {
      const { checkout_ref } = parse(refParam, req.params);
      const body = parse(z.strictObject({ outcome: z.enum(['succeeded', 'failed']) }), req.body);
      const done = await mock.complete(ctx.db, checkout_ref, body.outcome);
      if (!done) throw errors.invalidState('This checkout is not open.');
      return reply.status(202).send({ checkout_ref, outcome: body.outcome });
    });
    ctx.log.warn('mock payment provider is ENABLED (never in production)');
  }
}

/** Account deletion: pending orders end; paid orders and the ledger stay (finance, legal). */
export const deleteAccountOrders: AccountDataDeleter = async (ctx, account) => {
  await cancelPendingOrders(ctx.db, account.userId);
};

/** Support sees order counts by status only. */
export const commerceSupportSection: SupportSection = {
  name: 'orders',
  async read(db, { userId }) {
    const rows = await db
      .selectFrom('purchase_order')
      .select('status')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('user_id', '=', userId)
      .groupBy('status')
      .execute();
    return { by_status: Object.fromEntries(rows.map((r) => [r.status, r.n])) };
  },
};

const payloadId = (payload: Record<string, unknown>, key: string): string => {
  const v = payload[key];
  if (typeof v !== 'string') throw new PermanentJobError('BAD_PAYLOAD', `missing ${key}`);
  return v;
};

export function commerceModule(): Module {
  return {
    name: 'commerce',
    routes: (app, ctx) => routes(app, ctx, paymentProvider(ctx)),
    jobs: (ctx) => {
      const provider = paymentProvider(ctx);
      return [
        {
          kind: APPLY_EVENT_JOB,
          leaseMs: 60_000,
          async handle({ job }) {
            await applyEvent(ctx.db, ctx.log, payloadId(job.payload, 'payment_event_id'));
          },
        },
        {
          kind: SUBMIT_REFUND_JOB,
          leaseMs: 60_000,
          async handle({ job }) {
            await submitRefund(
              ctx.db,
              requireProvider(provider),
              payloadId(job.payload, 'refund_id'),
            );
          },
        },
        {
          kind: 'commerce.expire_orders',
          leaseMs: 60_000,
          async handle() {
            await expireOrders(ctx.db);
          },
        },
        {
          kind: 'commerce.reconcile',
          leaseMs: 5 * 60_000,
          async handle() {
            if (provider) await reconcile(ctx.db, provider, ctx.log);
          },
        },
        ...(provider instanceof MockPaymentProvider
          ? [
              {
                kind: MOCK_DELIVER_JOB,
                leaseMs: 60_000,
                async handle({ job }: { job: { payload: Record<string, unknown> } }) {
                  // Delivered through the same verification as an HTTP webhook.
                  const raw = payloadId(job.payload, 'body');
                  const event = provider.verifyWebhook(raw, {
                    [MOCK_SIGNATURE_HEADER]: provider.sign(raw),
                  });
                  await receiveEvent(ctx.db, provider, event, raw);
                },
              },
            ]
          : []),
      ];
    },
    schedules: [
      { kind: 'commerce.expire_orders', everyMs: 5 * 60_000 },
      { kind: 'commerce.reconcile', everyMs: 60 * 60_000 },
    ],
  };
}
