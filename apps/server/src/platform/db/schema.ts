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

export interface Database {
  job: JobTable;
  outbox_event: OutboxEventTable;
  audit_log: AuditLogTable;
  idempotency_record: IdempotencyRecordTable;
}
