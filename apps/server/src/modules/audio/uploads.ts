import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { UploadSessionTable } from '../../platform/db/schema.js';
import { AppError, errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId, type Id } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { metrics } from '../../platform/metrics.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import { quotaPolicy, FREE_POLICY_ID } from '../identity/index.js';
import type { Selectable } from 'kysely';

export const PRESIGN_SECONDS = 15 * 60;
export const UPLOAD_SESSION_SECONDS = 60 * 60;
/** States that still hold a quota reservation. */
export const RESERVING_STATES = ['created', 'uploading', 'quarantined', 'processing'] as const;

type UploadRow = Selectable<UploadSessionTable>;

export function uploadView(u: UploadRow) {
  return {
    upload_id: u.id,
    intent: u.intent,
    state: u.state,
    size_bytes: u.declared_bytes,
    created_at: u.created_at.toISOString(),
    expires_at: u.expires_at.toISOString(),
    audio_source_id: u.audio_source_id,
    failure_code: u.failure_code,
  };
}

export async function storageUsage(
  db: DbOrTx,
  workspaceId: string,
): Promise<{ usedBytes: number; reservedBytes: number }> {
  const used = await db
    .selectFrom('audio_asset as a')
    .innerJoin('audio_source as s', 's.id', 'a.audio_source_id')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('a.bytes'), sql<number>`0`).as('n'))
    .where('s.workspace_id', '=', workspaceId)
    .where('a.kind', '=', 'original')
    .where('s.status', 'not in', ['deleting', 'deleted'])
    .executeTakeFirst();
  const reserved = await db
    .selectFrom('upload_session')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('reserved_bytes'), sql<number>`0`).as('n'))
    .where('workspace_id', '=', workspaceId)
    .where('state', 'in', RESERVING_STATES)
    .executeTakeFirst();
  return { usedBytes: used?.n ?? 0, reservedBytes: reserved?.n ?? 0 };
}

function sanitizeTitle(filename: string | undefined): string | null {
  if (!filename) return null;
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  // Strip control characters; keep user text otherwise unchanged (rendered as text only).
  const clean = base
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 200);
  return clean.length > 0 ? clean : null;
}

export interface CreateUploadInput {
  intent: 'private_upload' | 'audio_log';
  size_bytes: number;
  sha256: string;
  filename?: string | undefined;
  content_type?: string | undefined;
}

/**
 * Creates an upload intent. The quota check and reservation run under a row lock
 * on the workspace so concurrent intents cannot overshoot the quota (AC-01).
 */
export async function createUploadIntent(
  ctx: AppContext,
  principal: Principal,
  input: CreateUploadInput,
) {
  const policy = quotaPolicy(ctx.config, FREE_POLICY_ID);
  if (input.size_bytes > policy.maxFileBytes) {
    throw errors.payloadTooLarge('PAYLOAD_TOO_LARGE', 'The file exceeds the maximum upload size.');
  }
  const workspaceId = principal.personalWorkspaceId;
  const uploadId = newId('upload');
  const key = `${uploadId}/${randomBytes(12).toString('hex')}`;

  const row = await ctx.db.transaction().execute(async (tx) => {
    await tx
      .selectFrom('workspace')
      .select('id')
      .where('id', '=', workspaceId)
      .forUpdate()
      .execute();
    const inFlight = await tx
      .selectFrom('upload_session')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('workspace_id', '=', workspaceId)
      .where('state', 'in', ['created', 'uploading', 'quarantined', 'processing'])
      .executeTakeFirstOrThrow();
    if (inFlight.n >= policy.maxConcurrentUploads) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many uploads are in progress. Try again later.',
        {
          retryable: true,
        },
      );
    }
    const usage = await storageUsage(tx, workspaceId);
    if (usage.usedBytes + usage.reservedBytes + input.size_bytes > policy.maxTotalBytes) {
      throw errors.payloadTooLarge('QUOTA_EXCEEDED', 'Your storage quota would be exceeded.');
    }
    return tx
      .insertInto('upload_session')
      .values({
        id: uploadId,
        workspace_id: workspaceId,
        created_by: principal.userId,
        intent: input.intent,
        declared_bytes: input.size_bytes,
        declared_sha256: input.sha256,
        declared_content_type: input.content_type ?? null,
        default_title: sanitizeTitle(input.filename),
        quarantine_key: key,
        state: 'created',
        reserved_bytes: input.size_bytes,
        expires_at: new Date(Date.now() + UPLOAD_SESSION_SECONDS * 1000),
        failure_code: null,
        audio_source_id: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });

  const signed = await ctx.blobs.presignPut(BUCKETS.quarantine, key, {
    bytes: input.size_bytes,
    sha256Base64: Buffer.from(input.sha256, 'hex').toString('base64'),
    expiresInSeconds: PRESIGN_SECONDS,
  });
  metrics.uploads.inc({ event: 'intent' });
  return {
    upload: uploadView(row),
    upload_url: signed.url,
    upload_method: signed.method,
    upload_headers: signed.headers,
    expires_at: signed.expiresAt.toISOString(),
  };
}

/** Upload sessions are visible only to their creator (404 otherwise). */
export async function getOwnUpload(
  db: Db,
  principal: Principal,
  uploadId: Id<'upload'>,
): Promise<UploadRow> {
  const row = await db
    .selectFrom('upload_session')
    .selectAll()
    .where('id', '=', uploadId)
    .where('created_by', '=', principal.userId)
    .executeTakeFirst();
  if (!row) throw errors.notFound();
  return row;
}

export async function cancelUpload(ctx: AppContext, principal: Principal, uploadId: Id<'upload'>) {
  const row = await getOwnUpload(ctx.db, principal, uploadId);
  if (row.state !== 'created')
    throw errors.invalidState('Only uploads that were not finalized can be cancelled.');
  const updated = await ctx.db
    .updateTable('upload_session')
    .set({ state: 'cancelled', updated_at: new Date() })
    .where('id', '=', uploadId)
    .where('state', '=', 'created')
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw errors.invalidState('The upload changed state.');
  await ctx.blobs.delete(BUCKETS.quarantine, row.quarantine_key);
  metrics.uploads.inc({ event: 'cancelled' });
  return uploadView(updated);
}

/**
 * Verifies the uploaded bytes (size + stored SHA-256), creates the AudioObject
 * chain in `processing` and emits `UploadFinalized` (audio-pipeline §2).
 */
export async function finalizeUpload(
  ctx: AppContext,
  principal: Principal,
  uploadId: Id<'upload'>,
  correlationId: string,
) {
  const row = await getOwnUpload(ctx.db, principal, uploadId);
  if (row.state !== 'created') {
    throw errors.invalidState('This upload was already finalized or is no longer active.');
  }
  if (row.expires_at.getTime() < Date.now()) {
    await ctx.db
      .updateTable('upload_session')
      .set({ state: 'expired', updated_at: new Date() })
      .where('id', '=', uploadId)
      .where('state', '=', 'created')
      .execute();
    throw errors.invalidState('This upload has expired.');
  }

  const head = await ctx.blobs.head(BUCKETS.quarantine, row.quarantine_key);
  if (!head)
    throw errors.unprocessable(
      'UPLOAD_MISSING',
      'No uploaded file was found. Upload the file, then finalize.',
    );
  const expectedChecksum = Buffer.from(row.declared_sha256, 'hex').toString('base64');
  const failure =
    head.bytes !== row.declared_bytes
      ? ('SIZE_MISMATCH' as const)
      : head.checksumSha256 !== undefined && head.checksumSha256 !== expectedChecksum
        ? ('CHECKSUM_MISMATCH' as const)
        : null;
  if (failure) {
    await ctx.db
      .updateTable('upload_session')
      .set({ state: 'failed', failure_code: failure, updated_at: new Date() })
      .where('id', '=', uploadId)
      .execute();
    await ctx.blobs.delete(BUCKETS.quarantine, row.quarantine_key);
    throw errors.unprocessable(
      failure,
      'The uploaded file does not match the declared size or checksum.',
    );
  }

  const result = await ctx.db.transaction().execute(async (tx) => {
    const locked = await tx
      .selectFrom('upload_session')
      .selectAll()
      .where('id', '=', uploadId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.state !== 'created') {
      throw errors.invalidState('This upload was already finalized or is no longer active.');
    }
    const objectId = newId('audioObject');
    const versionId = newId('audioVersion');
    const sourceId = newId('audioSource');
    await tx
      .insertInto('audio_object')
      .values({
        id: objectId,
        kind: locked.intent === 'audio_log' ? 'audio_log' : 'private_audio',
        current_version_id: versionId,
      })
      .execute();
    await tx
      .insertInto('audio_version')
      .values({
        id: versionId,
        audio_object_id: objectId,
        version_no: 1,
        recording_id: null,
        content_sha256: locked.declared_sha256,
        duration_ms: null,
        technical: JSON.stringify({}),
      })
      .execute();
    await tx
      .insertInto('audio_source')
      .values({
        id: sourceId,
        audio_version_id: versionId,
        workspace_id: locked.workspace_id,
        origin: locked.intent,
        visibility: 'private',
        status: 'processing',
        title: locked.default_title,
        created_by: principal.userId,
        failure_code: null,
        storage_prefix: `${sourceId}/${randomBytes(12).toString('hex')}`,
        deleted_at: null,
      })
      .execute();
    const updated = await tx
      .updateTable('upload_session')
      .set({ state: 'quarantined', audio_source_id: sourceId, updated_at: new Date() })
      .where('id', '=', uploadId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emit(tx, {
      type: 'UploadFinalized',
      schemaVersion: 1,
      subjectId: sourceId,
      workspaceId: locked.workspace_id,
      privacyScope: 'private',
      correlationId,
      payload: { upload_session_id: uploadId, audio_source_id: sourceId },
    });
    return updated;
  });
  metrics.uploads.inc({ event: 'finalized' });
  return uploadView(result);
}

/** Expires abandoned intents, deletes their quarantine objects, releases quota. */
export async function expireUploadSessions(ctx: AppContext): Promise<number> {
  const expired = await ctx.db
    .updateTable('upload_session')
    .set({ state: 'expired', updated_at: new Date() })
    .where('state', '=', 'created')
    .where('expires_at', '<', new Date())
    .returning(['quarantine_key'])
    .execute();
  for (const e of expired) await ctx.blobs.delete(BUCKETS.quarantine, e.quarantine_key);
  return expired.length;
}
