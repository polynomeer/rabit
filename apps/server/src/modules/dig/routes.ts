import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { errors } from '../../platform/errors.js';
import { routeLimit } from '../../platform/http/app.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requireOperator, requirePrincipal } from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  limitSchema,
  parse,
} from '../../platform/http/validation.js';
import { ANY_ID_PATTERN } from '../../platform/ids.js';
import { isEnabled, type FlagKey } from '../flags/index.js';
import { cutoffDate, isTimeZone } from '../catalog/index.js';
import { timeMachineCoverage } from './time-radio.js';
import { playlistView } from '../library/index.js';
import { AXIS_GROUP, type DigAxis } from './connections.js';
import {
  addStep,
  endSession,
  explore,
  getAxes,
  getSession,
  listSessions,
  moveCursor,
  recordAction,
  startSession,
  trailToPlaylist,
  updateSession,
  type DigDeps,
} from './service.js';
import { labelTimeline } from './labels.js';
import { artistJourney, compareReleases } from './journey.js';
import { lineageOf } from './lineage.js';
import { digCrate, newReleases } from './crates.js';
import { allShelves, deleteShelf, liveShelves, saveShelf, shelfInput } from './editorial.js';
import { decideBlindItem, getBlindDig, startBlindDig } from './blind.js';

const axis = z.enum(Object.keys(AXIS_GROUP) as [DigAxis, ...DigAxis[]]);
const entityParams = z.object({ entity_id: z.string().regex(ANY_ID_PATTERN) });
const sessionParams = z.object({ dig_session_id: idOf('digSession') });
const artistParams = z.object({ artist_id: idOf('artist') });

/** Exploration routes stay hidden (404) while their flag is off for the caller (ADR-0028). */
async function requireFlag(ctx: AppContext, key: FlagKey, userId: string) {
  if (!(await isEnabled(ctx.db, key, userId))) throw errors.notFound();
}

export const digRoutes =
  (deps: DigDeps) =>
  (app: FastifyInstance, ctx: AppContext): void => {
    app.get('/v1/dig/entities/:entity_id/axes', async (req) => {
      requirePrincipal(req.principal);
      const p = entityParams.safeParse(req.params);
      if (!p.success) throw errors.notFound();
      return getAxes(ctx.db, p.data.entity_id);
    });

    app.get('/v1/dig/entities/:entity_id/connections', async (req) => {
      const principal = requirePrincipal(req.principal);
      const p = entityParams.safeParse(req.params);
      if (!p.success) throw errors.notFound();
      const q = parse(
        z.object({
          axis,
          popularity: z.enum(['any', 'below_top_50', 'deep_cuts', 'obscure']).default('any'),
          include_inferred: z
            .enum(['true', 'false'])
            .default('true')
            .transform((v) => v === 'true'),
          limit: limitSchema,
          cursor: z.string().max(512).optional(),
        }),
        req.query,
      );
      return explore(ctx, deps, principal, p.data.entity_id, q);
    });

    /** Original-song lineage around a recording (samples, covers, remixes), 1–2 steps each way. */
    app.get('/v1/dig/entities/:entity_id/lineage', async (req) => {
      const principal = requirePrincipal(req.principal);
      const p = entityParams.safeParse(req.params);
      if (!p.success) throw errors.notFound();
      const q = parse(
        z.object({
          depth: z
            .enum(['1', '2'])
            .default('2')
            .transform((v): 1 | 2 => (v === '1' ? 1 : 2)),
          include_inferred: z
            .enum(['true', 'false'])
            .default('false')
            .transform((v) => v === 'true'),
        }),
        req.query,
      );
      return lineageOf(ctx, deps, principal, p.data.entity_id, q);
    });

    app.get('/v1/dig/crate', routeLimit(240, '1 hour'), async (req) => {
      const p = requirePrincipal(req.principal);
      const year = z.coerce.number().int().min(1900).max(2100);
      const q = parse(
        z
          .object({
            from: year.optional(),
            to: year.optional(),
            popularity: z.enum(['any', 'below_top_50', 'deep_cuts', 'obscure']).default('any'),
            size: z.coerce.number().int().min(1).max(24).default(12),
          })
          .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
            message: 'from must not be after to',
            path: ['from'],
          }),
        req.query,
      );
      return digCrate(ctx, deps, p, q);
    });

    app.get('/v1/dig/new-releases', routeLimit(600, '1 hour'), async (req) => {
      const p = requirePrincipal(req.principal);
      const q = parse(
        z.object({ size: z.coerce.number().int().min(1).max(24).default(12) }),
        req.query,
      );
      return newReleases(ctx, deps, p, q);
    });

    // Editorial shelves (ADR-0029): live ones for listeners, all of them for operators.
    app.get('/v1/editorial/shelves', routeLimit(600, '1 hour'), async (req) => {
      return liveShelves(ctx, deps, requirePrincipal(req.principal));
    });

    const shelfParams = z.object({ shelf_id: idOf('editorialShelf') });
    app.get('/v1/ops/editorial/shelves', async (req) => {
      requireOperator(req.principal);
      return { items: await allShelves(ctx.db) };
    });
    app.post('/v1/ops/editorial/shelves', async (req, reply) => {
      const op = requireOperator(req.principal);
      const shelf = await saveShelf(ctx.db, op, null, parse(shelfInput, req.body), req.id);
      return reply.status(201).send(shelf);
    });
    app.put('/v1/ops/editorial/shelves/:shelf_id', async (req) => {
      const op = requireOperator(req.principal);
      const { shelf_id } = parse(shelfParams, req.params);
      return saveShelf(ctx.db, op, shelf_id, parse(shelfInput, req.body), req.id);
    });
    app.delete('/v1/ops/editorial/shelves/:shelf_id', async (req, reply) => {
      const op = requireOperator(req.principal);
      const { shelf_id } = parse(shelfParams, req.params);
      const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.query);
      await deleteShelf(ctx.db, op, shelf_id, reason, req.id);
      return reply.status(204).send();
    });

    app.get('/v1/dig/labels/:label_id/timeline', async (req) => {
      requirePrincipal(req.principal);
      const p = z.object({ label_id: idOf('label') }).safeParse(req.params);
      if (!p.success) throw errors.notFound();
      return labelTimeline(ctx.db, deps, p.data.label_id);
    });

    /** Artist Journey (EX-02): releases and dated relations in date order; `cutoff_at` = historical view. */
    app.get('/v1/dig/artists/:artist_id/journey', routeLimit(600, '1 hour'), async (req) => {
      const p = requirePrincipal(req.principal);
      await requireFlag(ctx, 'exploration_journey', p.userId);
      const params = artistParams.safeParse(req.params);
      if (!params.success) throw errors.notFound();
      const q = parse(
        z.object({
          cutoff_at: z.iso
            .datetime({ offset: true })
            .transform((v) => new Date(v))
            .optional(),
          time_zone: z
            .string()
            .max(64)
            .refine(isTimeZone, { message: 'unknown time zone' })
            .default('Asia/Seoul'),
        }),
        req.query,
      );
      return artistJourney(ctx, deps, params.data.artist_id, q);
    });

    /** What a Time Radio cutoff leaves to listen to (setup screen, ADR-0034). */
    app.get('/v1/dig/time-machine/coverage', routeLimit(240, '1 hour'), async (req) => {
      const p = requirePrincipal(req.principal);
      await requireFlag(ctx, 'exploration_time_machine', p.userId);
      const q = parse(
        z.object({
          cutoff_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
          time_zone: z.string().max(64).refine(isTimeZone, { message: 'unknown time zone' }),
        }),
        req.query,
      );
      return timeMachineCoverage(ctx, deps, p, cutoffDate(q.cutoff_at, q.time_zone));
    });

    /** Album compare (EX-03): two releases of one artist, catalog facts only. */
    app.get('/v1/dig/artists/:artist_id/compare', routeLimit(600, '1 hour'), async (req) => {
      const p = requirePrincipal(req.principal);
      await requireFlag(ctx, 'exploration_compare', p.userId);
      const params = artistParams.safeParse(req.params);
      if (!params.success) throw errors.notFound();
      const q = parse(
        z.object({ release_a: idOf('release'), release_b: idOf('release') }),
        req.query,
      );
      return compareReleases(ctx, deps, params.data.artist_id, q.release_a, q.release_b);
    });

    const blindParams = z.object({ blind_dig_id: idOf('blindDig') });
    app.post('/v1/blind-digs', routeLimit(60, '1 hour'), async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({
          start_entity_id: z.string().regex(ANY_ID_PATTERN).optional(),
          popularity: z.enum(['any', 'below_top_50', 'deep_cuts', 'obscure']).default('any'),
        }),
        req.body ?? {},
      );
      return reply.status(201).send(await startBlindDig(ctx, deps, p, body));
    });

    app.get('/v1/blind-digs/:blind_dig_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { blind_dig_id } = parse(blindParams, req.params);
      return getBlindDig(ctx.db, p, blind_dig_id);
    });

    app.post('/v1/blind-digs/:blind_dig_id/items/:item_id/decision', async (req) => {
      const p = requirePrincipal(req.principal);
      const { blind_dig_id, item_id } = parse(
        blindParams.extend({ item_id: idOf('blindDigItem') }),
        req.params,
      );
      const { decision } = parse(z.strictObject({ decision: z.enum(['keep', 'pass']) }), req.body);
      return decideBlindItem(ctx, deps, p, blind_dig_id, item_id, decision);
    });

    app.get('/v1/dig-sessions', async (req) => {
      const p = requirePrincipal(req.principal);
      const q = parse(
        z.object({
          saved: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          limit: limitSchema,
          cursor: z.string().max(512).optional(),
        }),
        req.query,
      );
      return listSessions(ctx, p, q);
    });

    app.post('/v1/dig-sessions', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z
          .strictObject({
            entity_id: z.string().regex(ANY_ID_PATTERN).optional(),
            audio_source_id: idOf('audioSource').optional(),
          })
          .refine((b) => (b.entity_id === undefined) !== (b.audio_source_id === undefined), {
            message: 'exactly one of entity_id or audio_source_id is required',
          }),
        req.body,
      );
      return reply.status(201).send(await startSession(ctx.db, p, body));
    });

    app.get('/v1/dig-sessions/:dig_session_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      return getSession(ctx.db, p, dig_session_id);
    });

    app.patch('/v1/dig-sessions/:dig_session_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z
          .strictObject({
            title: z.string().max(200).nullable().optional(),
            saved: z.boolean().optional(),
          })
          .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' }),
        req.body,
      );
      return updateSession(ctx.db, p, dig_session_id, body);
    });

    app.post('/v1/dig-sessions/:dig_session_id/steps', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z.strictObject({
          from_seq: z.number().int().min(0).optional(),
          entity_id: z.string().regex(ANY_ID_PATTERN),
          axis,
          relation_id: idOf('relation').optional(),
          credit_id: idOf('credit').optional(),
        }),
        req.body,
      );
      const key = idempotencyKeyFrom(req.headers, false);
      const r = await withIdempotency(
        ctx.db,
        { userId: p.userId, operation: `dig.step:${dig_session_id}`, key, request: body },
        async () => ({ status: 201, body: await addStep(ctx.db, deps, p, dig_session_id, body) }),
      );
      return reply.status(r.status).send(r.body);
    });

    app.post('/v1/dig-sessions/:dig_session_id/cursor', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(z.strictObject({ seq: z.number().int().min(0) }), req.body);
      return moveCursor(ctx.db, p, dig_session_id, body.seq);
    });

    app.post('/v1/dig-sessions/:dig_session_id/nodes/:seq/actions', async (req) => {
      const p = requirePrincipal(req.principal);
      const params = parse(
        z.object({ dig_session_id: idOf('digSession'), seq: z.coerce.number().int().min(0) }),
        req.params,
      );
      const body = parse(z.strictObject({ action: z.enum(['played', 'saved']) }), req.body);
      return recordAction(ctx.db, p, params.dig_session_id, params.seq, body.action);
    });

    app.post('/v1/dig-sessions/:dig_session_id/end', async (req) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      return endSession(ctx.db, p, dig_session_id);
    });

    app.post('/v1/dig-sessions/:dig_session_id/playlist', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { dig_session_id } = parse(sessionParams, req.params);
      const body = parse(
        z.strictObject({ title: z.string().trim().min(1).max(200).optional() }),
        req.body ?? {},
      );
      const row = await trailToPlaylist(ctx.db, p, dig_session_id, body.title);
      const view = await playlistView(ctx, deps.catalogAccess, p, row);
      return reply.status(201).header('etag', etag(view.version)).send(view);
    });
  };
