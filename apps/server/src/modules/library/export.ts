import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import type { AppContext } from '../../app/context.js';
import type { Db } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';

export const EXPORT_LINK_SECONDS = 15 * 60;
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Extra JSON sections contributed by other contexts (e.g. DIG sessions). */
export type ExportSection = (ctx: AppContext, userId: string) => Promise<[string, unknown]>;

type ExportRow = {
  id: string;
  state: 'requested' | 'building' | 'ready' | 'expired' | 'failed';
  include_originals: boolean;
  object_key: string | null;
  expires_at: Date | null;
  failure_code: string | null;
  created_at: Date;
};

export async function exportView(ctx: AppContext, e: ExportRow) {
  const ready =
    e.state === 'ready' && e.object_key !== null && (e.expires_at?.getTime() ?? 0) > Date.now();
  const link = ready
    ? await ctx.blobs.presignGet(BUCKETS.exports, e.object_key ?? '', {
        expiresInSeconds: EXPORT_LINK_SECONDS,
        downloadName: `rabit-export-${e.id}.zip`,
      })
    : null;
  return {
    export_id: e.id,
    state: ready || e.state !== 'ready' ? e.state : 'expired',
    include_originals: e.include_originals,
    created_at: e.created_at.toISOString(),
    download_url: link?.url ?? null,
    expires_at: e.expires_at?.toISOString() ?? null,
    failure_code: e.failure_code,
  };
}

export async function requestExport(
  db: Db,
  principal: Principal,
  includeOriginals: boolean,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const e = await tx
      .insertInto('export_request')
      .values({
        id: newId('export'),
        user_id: principal.userId,
        state: 'requested',
        include_originals: includeOriginals,
        object_key: null,
        bytes: null,
        expires_at: null,
        failure_code: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emit(tx, {
      type: 'ExportRequested',
      schemaVersion: 1,
      subjectId: e.id,
      workspaceId: principal.personalWorkspaceId,
      privacyScope: 'private',
      correlationId,
      payload: { export_id: e.id },
    });
    return e;
  });
}

export async function getExport(ctx: AppContext, principal: Principal, id: string) {
  const e = await ctx.db
    .selectFrom('export_request')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (!e) throw errors.notFound();
  return exportView(ctx, e);
}

function extFor(codec: string | undefined): string {
  switch (codec) {
    case 'flac':
      return 'flac';
    case 'mp3':
      return 'mp3';
    case 'aac':
    case 'alac':
      return 'm4a';
    case 'vorbis':
    case 'opus':
      return 'ogg';
    default:
      return 'wav';
  }
}

/**
 * Builds the export archive: the user's own originals (never catalog masters,
 * LIB-006) plus JSON metadata. Idempotent: rebuilding overwrites the same key.
 */
export async function buildExport(
  ctx: AppContext,
  exportId: string,
  sections: ExportSection[],
): Promise<void> {
  const e = await ctx.db
    .selectFrom('export_request')
    .selectAll()
    .where('id', '=', exportId)
    .executeTakeFirst();
  if (!e || e.state === 'ready' || e.state === 'expired') return;
  await ctx.db
    .updateTable('export_request')
    .set({ state: 'building', updated_at: new Date() })
    .where('id', '=', exportId)
    .execute();

  const ws = await ctx.db
    .selectFrom('workspace')
    .select('id')
    .where('owner_user_id', '=', e.user_id)
    .where('type', '=', 'personal')
    .executeTakeFirst();
  const sources = ws
    ? await ctx.db
        .selectFrom('audio_source as s')
        .innerJoin('audio_version as v', 'v.id', 's.audio_version_id')
        .leftJoin('audio_asset as a', (j) =>
          j.onRef('a.audio_source_id', '=', 's.id').on('a.kind', '=', 'original'),
        )
        .select([
          's.id',
          's.origin',
          's.title',
          's.created_at',
          'v.duration_ms',
          'v.content_sha256',
          'v.technical',
          'a.bucket',
          'a.object_key',
        ])
        .where('s.workspace_id', '=', ws.id)
        .where('s.origin', '!=', 'catalog')
        .where('s.status', '=', 'ready')
        .execute()
    : [];
  const logs = await ctx.db
    .selectFrom('audio_log')
    .selectAll()
    .where('author_user_id', '=', e.user_id)
    .execute();
  const library = await ctx.db
    .selectFrom('library_item')
    .selectAll()
    .where('user_id', '=', e.user_id)
    .execute();
  const playlists = await ctx.db
    .selectFrom('playlist')
    .selectAll()
    .where('owner_user_id', '=', e.user_id)
    .execute();
  const items = playlists.length
    ? await ctx.db
        .selectFrom('playlist_item')
        .selectAll()
        .where(
          'playlist_id',
          'in',
          playlists.map((p) => p.id),
        )
        .orderBy('rank')
        .execute()
    : [];

  const work = await mkdtemp(join(tmpdir(), 'rabit-export-'));
  try {
    const zip = new yazl.ZipFile();
    const files: { source_id: string; path: string }[] = [];
    if (e.include_originals) {
      for (const s of sources) {
        if (!s.object_key || s.bucket !== BUCKETS.privateOriginals) continue;
        const local = join(work, s.id);
        if (!(await ctx.blobs.download(BUCKETS.privateOriginals, s.object_key, local))) continue;
        const path = `originals/${s.id}.${extFor(s.technical.codec)}`;
        zip.addFile(local, path);
        files.push({ source_id: s.id, path });
      }
    }
    const extra = await Promise.all(sections.map((s) => s(ctx, e.user_id)));
    const metadata = {
      format: 'rabit-export/1',
      exported_at: new Date().toISOString(),
      user_id: e.user_id,
      audio: sources.map((s) => ({
        audio_source_id: s.id,
        origin: s.origin,
        title: s.title,
        created_at: s.created_at.toISOString(),
        duration_ms: s.duration_ms,
        sha256: s.content_sha256,
        file: files.find((f) => f.source_id === s.id)?.path ?? null,
      })),
      audio_logs: logs.map((l) => ({
        audio_log_id: l.id,
        audio_source_id: l.audio_source_id,
        title: l.title,
        note: l.note,
        recorded_at: l.recorded_at.toISOString(),
        recorded_tz: l.recorded_tz,
        linked_recording_id: l.linked_recording_id,
        tags: l.tags,
      })),
      library: library.map((i) => ({
        ref_type: i.ref_type,
        ref_id: i.ref_id,
        origin: i.origin,
        note: i.note,
        saved_at: i.saved_at.toISOString(),
      })),
      playlists: playlists.map((p) => ({
        playlist_id: p.id,
        title: p.title,
        description: p.description,
        items: items
          .filter((i) => i.playlist_id === p.id)
          .map((i) => ({ ref_type: i.ref_type, ref_id: i.ref_id })),
      })),
      ...Object.fromEntries(extra),
    };
    zip.addBuffer(Buffer.from(JSON.stringify(metadata, null, 2)), 'metadata.json');
    zip.end();
    const zipPath = join(work, 'export.zip');
    await pipeline(zip.outputStream, createWriteStream(zipPath));
    const bytes = (await stat(zipPath)).size;
    const key = `${e.user_id}/${e.id}.zip`;
    await ctx.blobs.put(BUCKETS.exports, key, createReadStream(zipPath), {
      contentType: 'application/zip',
      bytes,
    });
    await ctx.db
      .updateTable('export_request')
      .set({
        state: 'ready',
        object_key: key,
        bytes,
        expires_at: new Date(Date.now() + EXPORT_RETENTION_MS),
        updated_at: new Date(),
      })
      .where('id', '=', exportId)
      .execute();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function expireExports(ctx: AppContext): Promise<number> {
  const rows = await ctx.db
    .updateTable('export_request')
    .set({ state: 'expired', updated_at: new Date() })
    .where('state', '=', 'ready')
    .where('expires_at', '<=', new Date())
    .returning(['object_key'])
    .execute();
  for (const r of rows) if (r.object_key) await ctx.blobs.delete(BUCKETS.exports, r.object_key);
  return rows.length;
}
