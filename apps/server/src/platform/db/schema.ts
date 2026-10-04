import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/** Timestamp read as Date, written as Date or ISO string. */
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
export type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>;

export interface JobTable {
  id: string;
  kind: string;
  payload: JSONColumnType<Record<string, unknown>>;
  dedupe_key: string;
  status: Generated<'queued' | 'running' | 'succeeded' | 'failed' | 'dead'>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Generated<Date>;
  locked_by: string | null;
  locked_until: Date | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface OutboxEventTable {
  id: string;
  type: string;
  schema_version: number;
  subject_id: string;
  workspace_id: string | null;
  privacy_scope: 'private' | 'catalog' | 'system';
  correlation_id: string | null;
  occurred_at: CreatedAt;
  payload: JSONColumnType<Record<string, unknown>>;
  dispatched_at: Date | null;
}

export interface AuditLogTable {
  id: string;
  actor_type: 'user' | 'operator' | 'system';
  actor_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string;
  reason: string | null;
  correlation_id: string | null;
  details: JSONColumnType<Record<string, unknown>>;
  at: CreatedAt;
}

export interface IdempotencyRecordTable {
  user_id: string;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: ColumnType<unknown, string | null, string | null>;
  created_at: CreatedAt;
}

export interface AppUserTable {
  id: string;
  oidc_issuer: string;
  oidc_subject: string;
  email_verified: boolean;
  status: Generated<'active' | 'deletion_requested' | 'deleted'>;
  license_country: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deletion_requested_at: Date | null;
}

export interface WorkspaceTable {
  id: string;
  type: 'personal' | 'studio' | 'catalog';
  owner_user_id: string | null;
  quota_policy_id: string;
  created_at: CreatedAt;
}

export interface MembershipTable {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'publisher' | 'editor' | 'viewer';
  created_at: CreatedAt;
}

export type SourceStatus = 'processing' | 'ready' | 'failed' | 'deleting' | 'deleted';
export type SourceOrigin = 'catalog' | 'private_upload' | 'audio_log';
export type UploadState =
  | 'created'
  | 'uploading'
  | 'quarantined'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface AudioObjectTable {
  id: string;
  kind: 'recording' | 'private_audio' | 'audio_log';
  current_version_id: string | null;
  created_at: CreatedAt;
}

export interface AudioTechnical {
  sample_rate?: number;
  channels?: number;
  codec?: string;
  container?: string;
  integrated_lufs?: number;
  true_peak_dbtp?: number;
}

export interface AudioVersionTable {
  id: string;
  audio_object_id: string;
  version_no: number;
  recording_id: string | null;
  content_sha256: string;
  duration_ms: number | null;
  technical: JSONColumnType<AudioTechnical>;
  created_at: CreatedAt;
}

export interface AudioSourceTable {
  id: string;
  audio_version_id: string;
  workspace_id: string;
  origin: SourceOrigin;
  visibility: 'private' | 'public';
  status: SourceStatus;
  title: string | null;
  created_by: string | null;
  failure_code: string | null;
  storage_prefix: string;
  deleted_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface AudioAssetTable {
  id: string;
  audio_source_id: string;
  kind: 'original' | 'hls' | 'waveform';
  bucket: string;
  object_key: string;
  sha256: string | null;
  bytes: number;
  codec: string | null;
  tool_version: string | null;
  encryption_key_ref: string;
  created_at: CreatedAt;
}

export interface UploadSessionTable {
  id: string;
  workspace_id: string;
  created_by: string;
  intent: 'private_upload' | 'audio_log';
  declared_bytes: number;
  declared_sha256: string;
  declared_content_type: string | null;
  default_title: string | null;
  quarantine_key: string;
  state: UploadState;
  reserved_bytes: number;
  expires_at: Timestamp;
  failure_code: string | null;
  audio_source_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PlaybackSessionTable {
  id: string;
  user_id: string;
  audio_source_id: string;
  capability: 'play';
  device_id: string;
  status: 'active' | 'expired' | 'revoked';
  issued_at: CreatedAt;
  expires_at: Timestamp;
  rights_grant_id: string | null;
  rights_version: number | null;
  entitlement_id: string | null;
  entitlement_version: number | null;
  refreshed_count: Generated<number>;
  revoked_reason: string | null;
}

export interface Database {
  audio_object: AudioObjectTable;
  audio_version: AudioVersionTable;
  audio_source: AudioSourceTable;
  audio_asset: AudioAssetTable;
  upload_session: UploadSessionTable;
  playback_session: PlaybackSessionTable;
  app_user: AppUserTable;
  workspace: WorkspaceTable;
  membership: MembershipTable;
  job: JobTable;
  outbox_event: OutboxEventTable;
  audit_log: AuditLogTable;
  idempotency_record: IdempotencyRecordTable;
}
