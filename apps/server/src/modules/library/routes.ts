import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import { routeLimit } from '../../platform/http/app.js';
import { withIdempotency } from '../../platform/http/idempotency.js';
import { requirePrincipal } from '../../platform/http/principal.js';
import {
  etag,
  idempotencyKeyFrom,
  idOf,
  limitSchema,
  parse,
  requireIfMatch,
} from '../../platform/http/validation.js';
import type { CatalogAccess } from '../playback/index.js';
import { exportView, getExport, requestExport } from './export.js';
import { addLibraryItem, listLibrary, removeLibraryItem } from './library.js';
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylistItems,
  listPlaylists,
  movePlaylistItem,
  playlistView,
  removePlaylistItem,
  updatePlaylist,
} from './playlists.js';

const refId = z.string().regex(/^(asr|rec|rel)_[0-9A-HJKMNP-TV-Z]{26}$/);

export const libraryRoutes =
  (deps: { catalogAccess: CatalogAccess }) =>
  (app: FastifyInstance, ctx: AppContext): void => {
    const ca = deps.catalogAccess;
    const plParams = z.object({ playlist_id: idOf('playlist') });
    const itemParams = z.object({ playlist_id: idOf('playlist'), item_id: idOf('playlistItem') });

    app.get('/v1/library', async (req) => {
      const p = requirePrincipal(req.principal);
      const q = parse(
        z.object({
          ref_type: z.enum(['audio_source', 'recording', 'release']).optional(),
          // One item's entry, if saved (e.g. a "saved" state on a detail page).
          ref_id: z.union([idOf('recording'), idOf('release'), idOf('audioSource')]).optional(),
          limit: limitSchema,
          cursor: z.string().max(512).optional(),
        }),
        req.query,
      );
      return listLibrary(ctx, ca, p, q);
    });

    app.post('/v1/library', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({
          ref_type: z.enum(['audio_source', 'recording', 'release']),
          ref_id: refId,
          note: z.string().max(1000).optional(),
        }),
        req.body,
      );
      return reply.status(201).send(await addLibraryItem(ctx, ca, p, body));
    });

    app.delete('/v1/library/:library_item_id', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { library_item_id } = parse(
        z.object({ library_item_id: idOf('libraryItem') }),
        req.params,
      );
      await removeLibraryItem(ctx.db, p, library_item_id);
      return reply.status(204).send();
    });

    app.get('/v1/playlists', async (req) => {
      const p = requirePrincipal(req.principal);
      const q = parse(
        z.object({ limit: limitSchema, cursor: z.string().max(512).optional() }),
        req.query,
      );
      return listPlaylists(ctx, p, q);
    });

    app.post('/v1/playlists', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({
          title: z.string().trim().min(1).max(200),
          description: z.string().max(2000).optional(),
        }),
        req.body,
      );
      const view = await playlistView(ctx, ca, p, await createPlaylist(ctx.db, p, body));
      return reply.status(201).header('etag', etag(view.version)).send(view);
    });

    app.get('/v1/playlists/:playlist_id', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id } = parse(plParams, req.params);
      const view = await getPlaylist(ctx, ca, p, playlist_id);
      return reply.header('etag', etag(view.version)).send(view);
    });

    app.get('/v1/playlists/:playlist_id/items', async (req) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id } = parse(plParams, req.params);
      const q = parse(
        z.object({ limit: limitSchema, cursor: z.string().max(512).optional() }),
        req.query,
      );
      return listPlaylistItems(ctx, ca, p, playlist_id, q);
    });

    app.patch('/v1/playlists/:playlist_id', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id } = parse(plParams, req.params);
      const version = requireIfMatch(req.headers);
      const body = parse(
        z
          .strictObject({
            title: z.string().trim().min(1).max(200).optional(),
            description: z.string().max(2000).nullable().optional(),
          })
          .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' }),
        req.body,
      );
      const view = await playlistView(
        ctx,
        ca,
        p,
        await updatePlaylist(ctx.db, p, playlist_id, version, body),
      );
      return reply.header('etag', etag(view.version)).send(view);
    });

    app.delete('/v1/playlists/:playlist_id', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id } = parse(plParams, req.params);
      await deletePlaylist(ctx.db, p, playlist_id, requireIfMatch(req.headers));
      return reply.status(204).send();
    });

    app.post('/v1/playlists/:playlist_id/items', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id } = parse(plParams, req.params);
      const version = requireIfMatch(req.headers);
      const body = parse(
        z.strictObject({
          ref_type: z.enum(['audio_source', 'recording']),
          ref_id: z.string().regex(/^(asr|rec)_[0-9A-HJKMNP-TV-Z]{26}$/),
          position: z.number().int().min(0).optional(),
        }),
        req.body,
      );
      const view = await playlistView(
        ctx,
        ca,
        p,
        await addPlaylistItem(ctx.db, p, playlist_id, version, body),
      );
      return reply.status(201).header('etag', etag(view.version)).send(view);
    });

    app.delete('/v1/playlists/:playlist_id/items/:item_id', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id, item_id } = parse(itemParams, req.params);
      const row = await removePlaylistItem(
        ctx.db,
        p,
        playlist_id,
        requireIfMatch(req.headers),
        item_id,
      );
      const view = await playlistView(ctx, ca, p, row);
      return reply.header('etag', etag(view.version)).send(view);
    });

    app.post('/v1/playlists/:playlist_id/items/:item_id/move', async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const { playlist_id, item_id } = parse(itemParams, req.params);
      const version = requireIfMatch(req.headers);
      const body = parse(z.strictObject({ position: z.number().int().min(0) }), req.body);
      const row = await movePlaylistItem(ctx.db, p, playlist_id, version, item_id, body.position);
      const view = await playlistView(ctx, ca, p, row);
      return reply.header('etag', etag(view.version)).send(view);
    });

    app.post('/v1/exports', routeLimit(5, '1 day'), async (req, reply) => {
      const p = requirePrincipal(req.principal);
      const body = parse(
        z.strictObject({ include_originals: z.boolean().default(true) }),
        req.body ?? {},
      );
      const key = idempotencyKeyFrom(req.headers, true);
      const r = await withIdempotency(
        ctx.db,
        { userId: p.userId, operation: 'export.create', key, request: body },
        async () => ({
          status: 202,
          body: await exportView(
            ctx,
            await requestExport(ctx.db, p, body.include_originals, req.id),
          ),
        }),
      );
      return reply.status(r.status).send(r.body);
    });

    app.get('/v1/exports/:export_id', async (req) => {
      const p = requirePrincipal(req.principal);
      const { export_id } = parse(z.object({ export_id: idOf('export') }), req.params);
      return getExport(ctx, p, export_id);
    });
  };
