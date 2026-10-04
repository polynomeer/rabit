import type { DbOrTx } from './db/db.js';
import { newId } from './ids.js';

export interface AuditEntry {
  actorType: 'user' | 'operator' | 'system';
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  reason?: string | null;
  correlationId?: string | null;
  /** IDs and states only; no personal data. */
  details?: Record<string, unknown>;
}

/** Appends to the audit log in the caller's transaction. */
export async function audit(db: DbOrTx, e: AuditEntry): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      id: newId('auditLog'),
      actor_type: e.actorType,
      actor_id: e.actorId,
      action: e.action,
      subject_type: e.subjectType,
      subject_id: e.subjectId,
      reason: e.reason ?? null,
      correlation_id: e.correlationId ?? null,
      details: JSON.stringify(e.details ?? {}),
    })
    .execute();
}
