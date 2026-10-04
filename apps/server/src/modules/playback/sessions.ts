import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { MediaTokenCodec } from '../../platform/media-token.js';
import { metrics } from '../../platform/metrics.js';
import { LADDER } from '../audio/index.js';
import { evaluatePolicy, type CatalogAccess, type DenyReason } from './policy.js';

export const SESSION_SECONDS = 5 * 60;
export const MEDIA_TOKEN_SECONDS = 60;

/** Resolves a catalog recording to its catalog audio source (catalog context). */
export type RecordingSourceResolver = (db: DbOrTx, recordingId: string) => Promise<string | null>;

export interface PlaybackDeps {
  catalogAccess: CatalogAccess;
  resolveRecordingSource: RecordingSourceResolver;
}

export function denialError(reason: DenyReason) {
  switch (reason) {
    case 'not_found':
      return errors.notFound();
    case 'not_ready':
      return errors.invalidState('This audio is still processing.');
    case 'rights_unavailable':
      return errors.denied('RIGHTS_UNAVAILABLE', 'This recording is not available in your region.');
    case 'subscription_required':
      return errors.denied(
        'SUBSCRIPTION_REQUIRED',
        'A Listen subscription is required to play this recording.',
      );
    case 'purchase_available':
      return errors.denied('PURCHASE_AVAILABLE', 'This recording is available for purchase.');
    case 'capability_denied':
      return errors.denied('CAPABILITY_DENIED', 'This action is not available for this audio.');
  }
}

interface SessionRow {
  id: string;
  audio_source_id: string;
  expires_at: Date;
}

function sessionView(
  ctx: AppContext,
  s: SessionRow,
  source: { origin: 'catalog' | 'private_upload' | 'audio_log'; storage_prefix: string },
) {
  const codec = new MediaTokenCodec(ctx.config.secrets.mediaToken);
  const exp = Math.min(
    Math.floor(Date.now() / 1000) + MEDIA_TOKEN_SECONDS,
    Math.floor(s.expires_at.getTime() / 1000),
  );
  const token = codec.sign({
    sessionId: s.id,
    namespace: source.origin === 'catalog' ? 'catalog' : 'private',
    prefix: source.storage_prefix,
    exp,
  });
  return {
    session_id: s.id,
    audio_source_id: s.audio_source_id,
    manifest_url: `${ctx.config.http.mediaPublicBaseUrl}/media/v1/${token}/index.m3u8`,
    expires_at: s.expires_at.toISOString(),
    media_token_expires_at: new Date(exp * 1000).toISOString(),
    source: source.origin,
    quality: {
      codec: LADDER.codec,
      bitrate_kbps: LADDER.bitrateKbps,
      lossless: false,
      provisional: LADDER.provisional,
    },
    capabilities: { seek: true, offline: false, stems: false, transform: false },
  };
}

export async function createPlaybackSession(
  ctx: AppContext,
  deps: PlaybackDeps,
  principal: Principal,
  input: {
    audio_source_id?: string | undefined;
    recording_id?: string | undefined;
    device_id: string;
  },
) {
  let sourceId = input.audio_source_id ?? null;
  if (!sourceId && input.recording_id) {
    sourceId = await deps.resolveRecordingSource(ctx.db, input.recording_id);
    if (!sourceId) throw errors.notFound();
  }
  if (!sourceId) throw errors.validation({ body: 'audio_source_id or recording_id is required' });
  const decision = await evaluatePolicy(ctx.db, deps.catalogAccess, principal, sourceId, 'play');
  if (!decision.allow) throw denialError(decision.reason);
  const now = Date.now();
  const row = await ctx.db
    .insertInto('playback_session')
    .values({
      id: newId('playbackSession'),
      user_id: principal.userId,
      audio_source_id: decision.source.id,
      capability: 'play',
      device_id: input.device_id,
      status: 'active',
      expires_at: new Date(now + SESSION_SECONDS * 1000),
      rights_grant_id: decision.rights?.grantId ?? null,
      rights_version: decision.rights?.version ?? null,
      entitlement_id: decision.entitlement?.id ?? null,
      entitlement_version: decision.entitlement?.version ?? null,
      revoked_reason: null,
    })
    .returning(['id', 'audio_source_id', 'expires_at'])
    .executeTakeFirstOrThrow();
  return sessionView(ctx, row, decision.source);
}

/** Re-runs the policy; a denial revokes the session (rights checked at access time). */
export async function refreshPlaybackSession(
  ctx: AppContext,
  deps: PlaybackDeps,
  principal: Principal,
  sessionId: string,
) {
  const s = await ctx.db
    .selectFrom('playback_session')
    .selectAll()
    .where('id', '=', sessionId)
    .where('user_id', '=', principal.userId)
    .executeTakeFirst();
  if (!s) throw errors.notFound();
  const decision = await evaluatePolicy(
    ctx.db,
    deps.catalogAccess,
    principal,
    s.audio_source_id,
    'play',
  );
  if (!decision.allow) {
    await revokeSessions(ctx.db, { sessionId: s.id }, decision.reason);
    throw denialError(decision.reason);
  }
  if (s.status !== 'active' || s.expires_at.getTime() <= Date.now()) {
    throw errors.invalidState('This playback session has ended. Start a new session.');
  }
  const row = await ctx.db
    .updateTable('playback_session')
    .set((eb) => ({
      expires_at: new Date(Date.now() + SESSION_SECONDS * 1000),
      refreshed_count: eb('refreshed_count', '+', 1),
      rights_version: decision.rights?.version ?? null,
      entitlement_version: decision.entitlement?.version ?? null,
    }))
    .where('id', '=', s.id)
    .where('status', '=', 'active')
    .returning(['id', 'audio_source_id', 'expires_at'])
    .executeTakeFirst();
  if (!row) throw errors.invalidState('This playback session has ended. Start a new session.');
  return sessionView(ctx, row, decision.source);
}

export async function revokeSessions(
  db: DbOrTx,
  filter:
    | { sessionId: string }
    | { audioSourceId: string }
    | { rightsGrantId: string; belowVersion: number }
    | { entitlementId: string; belowVersion: number }
    | { userId: string },
  reason: string,
): Promise<number> {
  let q = db
    .updateTable('playback_session')
    .set({ status: 'revoked', revoked_reason: reason })
    .where('status', '=', 'active');
  if ('sessionId' in filter) q = q.where('id', '=', filter.sessionId);
  else if ('audioSourceId' in filter) q = q.where('audio_source_id', '=', filter.audioSourceId);
  else if ('rightsGrantId' in filter)
    q = q
      .where('rights_grant_id', '=', filter.rightsGrantId)
      .where('rights_version', '<', filter.belowVersion);
  else if ('entitlementId' in filter)
    q = q
      .where('entitlement_id', '=', filter.entitlementId)
      .where('entitlement_version', '<', filter.belowVersion);
  else q = q.where('user_id', '=', filter.userId);
  const res = await q.executeTakeFirst();
  const n = Number(res.numUpdatedRows);
  if (n > 0) metrics.sessionsRevoked.inc({ reason }, n);
  return n;
}

/**
 * Data-plane check for each media request: the session must be active and unexpired,
 * and the source still ready with the same storage prefix (immediate block on delete).
 */
export async function mediaAccessAllowed(
  db: DbOrTx,
  claims: { sessionId: string; prefix: string },
): Promise<boolean> {
  const row = await db
    .selectFrom('playback_session as p')
    .innerJoin('audio_source as s', 's.id', 'p.audio_source_id')
    .select('p.id')
    .where('p.id', '=', claims.sessionId)
    .where('p.status', '=', 'active')
    .where('p.expires_at', '>', new Date())
    .where('s.status', '=', 'ready')
    .where('s.storage_prefix', '=', claims.prefix)
    .executeTakeFirst();
  return row !== undefined;
}
