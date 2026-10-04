import type { Db, DbOrTx } from '../db/db.js';
import { newId } from '../ids.js';
import { enqueue } from './queue.js';

export interface DomainEvent {
  type: string;
  schemaVersion: number;
  subjectId: string;
  workspaceId?: string | null;
  privacyScope: 'private' | 'catalog' | 'system';
  correlationId?: string | null;
  /** IDs and states only — never titles, notes, audio, URLs, tokens or location. */
  payload: Record<string, unknown>;
}

/** Writes an event in the caller's transaction (transactional outbox). */
export async function emit(db: DbOrTx, event: DomainEvent): Promise<string> {
  const id = newId('event');
  await db
    .insertInto('outbox_event')
    .values({
      id,
      type: event.type,
      schema_version: event.schemaVersion,
      subject_id: event.subjectId,
      workspace_id: event.workspaceId ?? null,
      privacy_scope: event.privacyScope,
      correlation_id: event.correlationId ?? null,
      payload: JSON.stringify(event.payload),
      dispatched_at: null,
    })
    .execute();
  return id;
}

/** Event type → job kinds that consume it. */
export type Subscriptions = Record<string, string[]>;

/**
 * Moves pending events to consumer jobs. Each (event, consumer) pair becomes one
 * job with dedupe key `<kind>:<event id>`, so re-dispatch is harmless.
 */
export async function dispatchOutbox(
  db: Db,
  subscriptions: Subscriptions,
  batch = 100,
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const events = await tx
      .selectFrom('outbox_event')
      .selectAll()
      .where('dispatched_at', 'is', null)
      .orderBy('occurred_at')
      .limit(batch)
      .forUpdate()
      .skipLocked()
      .execute();
    for (const ev of events) {
      for (const kind of subscriptions[ev.type] ?? []) {
        await enqueue(tx, {
          kind,
          payload: {
            event_id: ev.id,
            event_type: ev.type,
            subject_id: ev.subject_id,
            // Database clock, comparable with other database-default timestamps.
            occurred_at: ev.occurred_at.toISOString(),
            ...ev.payload,
          },
          dedupeKey: `${kind}:${ev.id}`,
          correlationId: ev.correlation_id,
        });
      }
      await tx
        .updateTable('outbox_event')
        .set({ dispatched_at: new Date() })
        .where('id', '=', ev.id)
        .execute();
    }
    return events.length;
  });
}
