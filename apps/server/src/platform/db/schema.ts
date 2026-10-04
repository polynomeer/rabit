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

export interface AudioLogTable {
  id: string;
  audio_source_id: string;
  author_user_id: string;
  title: string;
  note: string | null;
  recorded_at: Timestamp;
  recorded_tz: string;
  linked_recording_id: string | null;
  tags: string[];
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type Basis = 'verified_fact' | 'declared' | 'ml_inferred';
export type VerificationState =
  | 'self_declared'
  | 'distributor_verified'
  | 'signature_valid'
  | 'process_evidence_reviewed'
  | 'rights_reviewed';
export type EntityType = 'artist' | 'person' | 'label' | 'release' | 'recording';
export type CreditRole =
  | 'composer'
  | 'lyricist'
  | 'producer'
  | 'engineer'
  | 'mixing_engineer'
  | 'mastering_engineer'
  | 'performer'
  | 'featured_artist'
  | 'arranger';
export type RelationType =
  'samples' | 'covers' | 'remix_of' | 'influenced_by' | 'member_of' | 'signed_to';
export type GrantStatus = 'active' | 'suspended' | 'revoked' | 'expired';

export interface MusicEntityTable {
  id: string;
  entity_type: EntityType;
  display_name: string;
  sort_name: string;
  search_tsv: ColumnType<string, never, never>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface RecordingTable {
  id: string;
  title: string;
  isrc: string | null;
  duration_ms: number | null;
  catalog_audio_source_id: string | null;
}

export interface RecordingArtistTable {
  recording_id: string;
  artist_id: string;
  ord: number;
}

export interface ReleaseTable {
  id: string;
  title: string;
  release_type: 'album' | 'single' | 'ep' | 'compilation';
  label_id: string | null;
  release_date: ColumnType<string | null, string | null, string | null>;
  upc: string | null;
}

export interface ReleaseArtistTable {
  release_id: string;
  artist_id: string;
  ord: number;
}

export interface ReleaseTrackTable {
  release_id: string;
  disc_no: number;
  position: number;
  recording_id: string;
}

export interface CreditTable {
  id: string;
  subject_entity_id: string;
  contributor_entity_id: string;
  role: CreditRole;
  instrument: string | null;
  creation_method: 'human' | 'ai_assisted' | 'ai_generated' | 'unknown';
  basis: Basis;
  verification_state: VerificationState;
  source: string;
  evidence_ref: string | null;
  created_at: CreatedAt;
}

export interface MusicRelationTable {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: RelationType;
  basis: Basis;
  confidence: number | null;
  verification_state: VerificationState;
  source: string;
  evidence_ref: string | null;
  license_status: 'unknown' | 'licensed' | 'not_applicable';
  valid_from: ColumnType<string | null, string | null, string | null>;
  valid_to: ColumnType<string | null, string | null, string | null>;
  created_at: CreatedAt;
}

export interface RightsGrantTable {
  id: string;
  recording_id: string;
  rights_holder: string;
  territories: string[];
  uses: string[];
  valid_from: Timestamp;
  valid_to: Timestamp | null;
  status: GrantStatus;
  contract_ref: string;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SubscriptionTable {
  id: string;
  user_id: string;
  plan: string;
  state: 'active' | 'past_due' | 'cancelled' | 'expired';
  paid_through: Timestamp;
  source: 'operator' | 'sandbox';
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface EntitlementTable {
  id: string;
  user_id: string;
  scope: 'catalog_all' | 'release' | 'recording';
  resource_id: string | null;
  capabilities: string[];
  origin: 'subscription' | 'purchase' | 'grant';
  origin_ref: string;
  valid_from: Generated<Date>;
  valid_to: Timestamp | null;
  status: GrantStatus;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface LibraryItemTable {
  id: string;
  user_id: string;
  ref_type: 'audio_source' | 'recording' | 'release';
  ref_id: string;
  origin: 'uploaded' | 'logged' | 'saved';
  note: string | null;
  saved_at: CreatedAt;
}

export interface PlaylistTable {
  id: string;
  owner_user_id: string;
  title: string;
  description: string | null;
  visibility: Generated<'private'>;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PlaylistItemTable {
  id: string;
  playlist_id: string;
  rank: number;
  ref_type: 'audio_source' | 'recording';
  ref_id: string;
  added_at: CreatedAt;
}

export interface ExportRequestTable {
  id: string;
  user_id: string;
  state: 'requested' | 'building' | 'ready' | 'expired' | 'failed';
  include_originals: boolean;
  object_key: string | null;
  bytes: number | null;
  expires_at: Timestamp | null;
  failure_code: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type PopularityTier = 'top' | 'upper' | 'deep_cut' | 'obscure' | 'unknown';

export interface ListeningEventTable {
  id: string;
  session_id: string;
  user_id: string;
  recording_id: string | null;
  client_event_id: string;
  sequence: number;
  type: 'started' | 'heartbeat' | 'seek' | 'paused' | 'ended';
  position_ms: number;
  played_ms: number;
  client_time: Timestamp;
  received_at: CreatedAt;
  accepted: boolean;
  reject_reason: string | null;
}

export interface RecordingPopularityTable {
  recording_id: string;
  window_days: number;
  distinct_listeners: number;
  plays: number;
  percentile: number | null;
  tier: PopularityTier;
  policy_version: string;
  computed_at: UpdatedAt;
}

export interface DigEvidence {
  basis: Basis;
  verification_state: VerificationState;
  source: string;
  confidence: number | null;
  license_status: 'unknown' | 'licensed' | 'not_applicable' | null;
  explanation: string;
}

export interface DigSessionTable {
  id: string;
  user_id: string;
  start_entity_id: string | null;
  start_audio_source_id: string | null;
  state: 'active' | 'ended';
  title: string | null;
  saved: Generated<boolean>;
  visibility: Generated<'private'>;
  current_seq: Generated<number>;
  started_at: CreatedAt;
  ended_at: Date | null;
}

export interface DigTrailNodeTable {
  id: string;
  session_id: string;
  seq: number;
  parent_seq: number | null;
  entity_id: string;
  via_axis: string | null;
  via_relation_id: string | null;
  via_credit_id: string | null;
  via_evidence: JSONColumnType<DigEvidence> | null;
  played: Generated<boolean>;
  saved: Generated<boolean>;
  created_at: CreatedAt;
}

export interface Database {
  listening_event: ListeningEventTable;
  recording_popularity: RecordingPopularityTable;
  dig_session: DigSessionTable;
  dig_trail_node: DigTrailNodeTable;
  music_entity: MusicEntityTable;
  recording: RecordingTable;
  recording_artist: RecordingArtistTable;
  release: ReleaseTable;
  release_artist: ReleaseArtistTable;
  release_track: ReleaseTrackTable;
  credit: CreditTable;
  music_relation: MusicRelationTable;
  rights_grant: RightsGrantTable;
  subscription: SubscriptionTable;
  entitlement: EntitlementTable;
  library_item: LibraryItemTable;
  playlist: PlaylistTable;
  playlist_item: PlaylistItemTable;
  export_request: ExportRequestTable;
  audio_log: AudioLogTable;
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
