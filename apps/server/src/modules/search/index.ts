import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { Module } from '../../app/modules.js';
import { routeLimit } from '../../platform/http/app.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import { limitSchema, parse } from '../../platform/http/validation.js';
import type { AccountDataDeleter } from '../identity/index.js';
import { indexEntity, indexSource, removeDocument } from './indexer.js';
import { search } from './query.js';

export { indexEntity, indexSource } from './indexer.js';

const KINDS = [
  'recording',
  'release',
  'artist',
  'person',
  'label',
  'private_audio',
  'audio_log',
] as const;

function routes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/search', routeLimit(120, '1 minute'), async (req) => {
    const p = requirePrincipal(req.principal);
    const q = parse(
      z.object({
        q: z.string().trim().min(1).max(200),
        scope: z.enum(['all', 'catalog', 'mine']).default('all'),
        types: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()) : null))
          .pipe(z.array(z.enum(KINDS)).min(1).nullable()),
        // `semantic` is reserved for P2 (SRC-004); only text search exists in MVP.
        mode: z.enum(['text']).default('text'),
        limit: limitSchema,
        cursor: z.string().max(512).optional(),
      }),
      req.query,
    );
    return search(ctx, p, q);
  });
}

export const deleteAccountSearch: AccountDataDeleter = async (ctx, account) => {
  await ctx.db
    .deleteFrom('search_document')
    .where('owner_workspace_id', '=', account.workspaceId)
    .execute();
};

const sourcePayload = z.object({ audio_source_id: z.string() });

export function searchModule(): Module {
  return {
    name: 'search',
    routes,
    jobs: (ctx) => [
      {
        kind: 'search.index_source',
        leaseMs: 60_000,
        async handle({ job }) {
          await indexSource(ctx.db, sourcePayload.parse(job.payload).audio_source_id);
        },
      },
      {
        kind: 'search.remove_source',
        leaseMs: 60_000,
        async handle({ job }) {
          await removeDocument(ctx.db, sourcePayload.parse(job.payload).audio_source_id);
        },
      },
      {
        kind: 'search.index_entity',
        leaseMs: 60_000,
        async handle({ job }) {
          await indexEntity(
            ctx.db,
            z.object({ entity_id: z.string() }).parse(job.payload).entity_id,
          );
        },
      },
    ],
    subscriptions: {
      AudioReady: ['search.index_source'],
      AudioMetadataChanged: ['search.index_source'],
      SourceDeletionRequested: ['search.remove_source'],
      CatalogEntityChanged: ['search.index_entity'],
    },
  };
}
