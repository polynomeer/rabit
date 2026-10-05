import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import {
  requireOperator,
  requirePrincipal,
  type Principal,
} from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  isoTimestamp,
  parse,
  requireIfMatch,
} from '../../platform/http/validation.js';
import { ANY_ID_PATTERN } from '../../platform/ids.js';
import { errors } from '../../platform/errors.js';
import { entitySummary, getRecording, getRelease } from './entities.js';
import { removeCatalogAudio } from './removal.js';
import { changeGrantStatus, createGrant } from './rights.js';

export interface Playability {
  playable: boolean;
  reason: string | null;
}

/**
 * Playability of catalog sources for the caller, from the playback policy, in
 * input order and in one batch (review #6). A missing source is `no_audio`.
 */
export type CatalogPlayability = (
  db: DbOrTx,
  principal: Principal,
  sourceIds: readonly (string | null)[],
) => Promise<Playability[]>;

const reason = z.string().min(3).max(500);

export const catalogRoutes =
  (deps: { playability: CatalogPlayability }) =>
  (app: FastifyInstance, ctx: AppContext): void => {
    app.get('/v1/recordings/:recording_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { recording_id } = parse(z.object({ recording_id: idOf('recording') }), req.params);
      const { catalog_audio_source_id, ...rec } = await getRecording(ctx.db, recording_id);
      const [playability] = await deps.playability(ctx.db, p, [catalog_audio_source_id]);
      return { ...rec, playability };
    });

    app.get('/v1/releases/:release_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { release_id } = parse(z.object({ release_id: idOf('release') }), req.params);
      const rel = await getRelease(ctx.db, release_id);
      const playable = await deps.playability(
        ctx.db,
        p,
        rel.tracks.map((t) => t.catalog_audio_source_id),
      );
      const tracks = rel.tracks.map(({ catalog_audio_source_id: _source, ...t }, i) => ({
        ...t,
        playability: playable[i],
      }));
      return { ...rel, tracks };
    });

    app.get('/v1/entities/:entity_id', async (req) => {
      requirePrincipal(req.principal);
      const params = z
        .object({ entity_id: z.string().regex(ANY_ID_PATTERN) })
        .safeParse(req.params);
      if (!params.success) throw errors.notFound();
      return entitySummary(ctx.db, params.data.entity_id);
    });

    app.post('/v1/ops/recordings/:recording_id/audio-removal', async (req, reply) => {
      const op = requireOperator(req.principal);
      const { recording_id } = parse(z.object({ recording_id: idOf('recording') }), req.params);
      const body = parse(z.strictObject({ reason }), req.body);
      const key = idempotencyKeyFrom(req.headers, true);
      const r = await withIdempotency(
        ctx.db,
        {
          userId: op.userId,
          operation: 'ops.recording.audio_removal',
          key,
          request: { recording_id, ...body },
        },
        async () => ({
          status: 202,
          body: await removeCatalogAudio(ctx.db, op, recording_id, body.reason, req.id),
        }),
      );
      return reply.status(r.status).send(r.body);
    });

    app.post('/v1/ops/rights-grants', async (req, reply) => {
      const op = requireOperator(req.principal);
      const body = parse(
        z.strictObject({
          recording_id: idOf('recording'),
          rights_holder: z.string().min(1).max(200),
          territories: z.array(z.string().regex(/^([A-Z]{2}|WORLD)$/)).min(1),
          uses: z
            .array(z.enum(['stream', 'download', 'preview', 'transform', 'stem', 'analysis']))
            .min(1),
          valid_from: isoTimestamp,
          valid_to: isoTimestamp.optional(),
          contract_ref: z.string().min(1).max(200),
          reason,
        }),
        req.body,
      );
      const key = idempotencyKeyFrom(req.headers, true);
      const r = await withIdempotency(
        ctx.db,
        { userId: op.userId, operation: 'ops.rights_grant.create', key, request: body },
        async () => {
          const { reason: why, ...input } = body;
          const grant = await ctx.db
            .transaction()
            .execute((tx) =>
              createGrant(tx, { type: 'operator', id: op.userId }, input, why, req.id),
            );
          return { status: 201, body: grant };
        },
      );
      return reply.status(r.status).header('etag', etag(r.body.version)).send(r.body);
    });

    app.post('/v1/ops/rights-grants/:rights_grant_id/status', async (req, reply) => {
      const op = requireOperator(req.principal);
      const { rights_grant_id } = parse(
        z.object({ rights_grant_id: idOf('rightsGrant') }),
        req.params,
      );
      const version = requireIfMatch(req.headers);
      const body = parse(
        z.strictObject({ status: z.enum(['active', 'suspended', 'revoked']), reason }),
        req.body,
      );
      const g = await changeGrantStatus(
        ctx.db,
        op,
        rights_grant_id,
        version,
        body.status,
        body.reason,
        req.id,
      );
      return reply.header('etag', etag(g.version)).send(g);
    });
  };
