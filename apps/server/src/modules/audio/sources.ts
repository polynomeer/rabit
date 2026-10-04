import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { AudioSourceTable, AudioVersionTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import type { Id } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { BUCKETS, type Bucket } from '../../platform/storage/blob-store.js';

export interface SourceRow extends Selectable<AudioSourceTable> {
  audio_object_id: string;
  kind: 'recording' | 'private_audio' | 'audio_log';
  duration_ms: number | null;
  technical: Selectable<AudioVersionTable>['technical'];
  recording_id: string | null;
}

function sourceQuery(db: DbOrTx) {
  return db
    .selectFrom('audio_source as s')
    .innerJoin('audio_version as v', 'v.id', 's.audio_version_id')
    .innerJoin('audio_object as o', 'o.id', 'v.audio_object_id')
    .selectAll('s')
    .select([
      'o.id as audio_object_id',
      'o.kind',
      'v.duration_ms',
      'v.technical',
      'v.recording_id',
    ]);
}

export function mediaBucket(origin: SourceRow['origin']): Bucket {
  return origin === 'catalog' ? BUCKETS.catalogMedia : BUCKETS.privateMedia;
}

export function originalsBucket(origin: SourceRow['origin']): Bucket {
  return origin === 'catalog' ? BUCKETS.catalogOriginals : BUCKETS.privateOriginals;
}

/** Any source by id, no access check. Callers must apply the playback policy. */
export async function getSourceUnchecked(db: DbOrTx, id: string): Promise<SourceRow | undefined> {
  return sourceQuery(db).where('s.id', '=', id).executeTakeFirst();
}

/**
 * A source the principal's workspace owns. Not-owned and missing are the same
 * 404 so private existence never leaks (T04). Deleted sources are hidden.
 */
export async function getOwnSource(
  db: DbOrTx,
  principal: Principal,
  id: string,
): Promise<SourceRow> {
  const row = await sourceQuery(db)
    .innerJoin('membership as m', 'm.workspace_id', 's.workspace_id')
    .where('m.user_id', '=', principal.userId)
    .where('s.id', '=', id)
    .where('s.origin', '!=', 'catalog')
    .where('s.status', '!=', 'deleted')
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  return row;
}

export function sourceView(s: SourceRow, opts: { owner: boolean }) {
  const ready = s.status === 'ready';
  return {
    audio_source_id: s.id,
    audio_object_id: s.audio_object_id,
    version_id: s.audio_version_id,
    kind: s.kind,
    origin: s.origin,
    visibility: s.visibility,
    status: s.status,
    title: s.title,
    duration_ms: s.duration_ms,
    created_at: s.created_at.toISOString(),
    failure_code: s.failure_code,
    capabilities: {
      play: ready,
      download_export: opts.owner && s.origin !== 'catalog',
      publish: false,
      analyze: false,
    },
    technical: {
      ...(s.technical.sample_rate !== undefined ? { sample_rate: s.technical.sample_rate } : {}),
      ...(s.technical.channels !== undefined ? { channels: s.technical.channels } : {}),
      ...(s.technical.codec !== undefined ? { codec: s.technical.codec } : {}),
      ...(s.technical.integrated_lufs !== undefined
        ? { integrated_lufs: s.technical.integrated_lufs }
        : {}),
      ...(s.technical.true_peak_dbtp !== undefined
        ? { true_peak_dbtp: s.technical.true_peak_dbtp }
        : {}),
    },
  };
}

export async function listOwnSources(
  ctx: AppContext,
  principal: Principal,
  q: {
    origin?: 'private_upload' | 'audio_log' | undefined;
    limit: number;
    cursor?: string | undefined;
  },
) {
  const queryKey = `sources:${q.origin ?? 'all'}`;
  const pos = ctx.cursors.decode({ userId: principal.userId, query: queryKey }, q.cursor);
  let query = sourceQuery(ctx.db)
    .innerJoin('membership as m', 'm.workspace_id', 's.workspace_id')
    .where('m.user_id', '=', principal.userId)
    .where('s.origin', '!=', 'catalog')
    .where('s.status', 'not in', ['deleting', 'deleted']);
  if (q.origin) query = query.where('s.origin', '=', q.origin);
  if (pos) {
    const [createdAt, id] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('s.created_at', '<', new Date(createdAt)),
        eb.and([eb('s.created_at', '=', new Date(createdAt)), eb('s.id', '<', id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('s.created_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((s) => sourceView(s, { owner: true })),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode({ userId: principal.userId, query: queryKey }, [
            last.created_at.toISOString(),
            last.id,
          ])
        : null,
  };
}

export async function updateSourceTitle(
  db: Db,
  principal: Principal,
  id: Id<'audioSource'>,
  title: string,
) {
  const src = await getOwnSource(db, principal, id);
  if (src.status === 'deleting') throw errors.notFound();
  await db
    .updateTable('audio_source')
    .set({ title, updated_at: new Date() })
    .where('id', '=', id)
    .execute();
  return sourceView({ ...src, title }, { owner: true });
}

/**
 * Deletion (LIB-008): access is blocked in the same transaction (status `deleting`
 * + tombstone); assets, search documents and sessions are removed asynchronously.
 */
export async function requestSourceDeletion(
  db: DbOrTx,
  principal: Principal,
  id: string,
  correlationId: string,
) {
  const src = await getOwnSource(db, principal, id);
  if (src.status === 'deleting') return sourceView(src, { owner: true });
  const now = new Date();
  await markDeleting(db, src.id, src.workspace_id, now, correlationId);
  return sourceView({ ...src, status: 'deleting', deleted_at: now }, { owner: true });
}

export async function markDeleting(
  db: DbOrTx,
  sourceId: string,
  workspaceId: string,
  now: Date,
  correlationId: string | null,
): Promise<void> {
  const res = await db
    .updateTable('audio_source')
    .set({ status: 'deleting', deleted_at: now, updated_at: now })
    .where('id', '=', sourceId)
    .where('status', 'not in', ['deleting', 'deleted'])
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) return;
  await emit(db, {
    type: 'SourceDeletionRequested',
    schemaVersion: 1,
    subjectId: sourceId,
    workspaceId,
    privacyScope: 'private',
    correlationId,
    payload: { audio_source_id: sourceId },
  });
}

export async function readWaveform(ctx: AppContext, principal: Principal, id: string) {
  const src = await getOwnSource(ctx.db, principal, id);
  if (src.status !== 'ready') throw errors.invalidState('The waveform is not available yet.');
  const asset = await ctx.db
    .selectFrom('audio_asset')
    .select(['bucket', 'object_key'])
    .where('audio_source_id', '=', src.id)
    .where('kind', '=', 'waveform')
    .executeTakeFirst();
  if (!asset) throw errors.invalidState('The waveform is not available.');
  const obj = await ctx.blobs.getStream(asset.bucket as Bucket, asset.object_key);
  if (!obj) throw errors.invalidState('The waveform is not available.');
  const chunks: Buffer[] = [];
  for await (const c of obj.body) chunks.push(c as Buffer);
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    samples_per_peak: number;
    sample_rate: number;
    peaks: number[];
  };
  return { audio_source_id: src.id, ...data };
}
