import { sql } from 'kysely';
import type { Db } from '../../platform/db/db.js';
import { audit } from '../../platform/audit.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { markDeleting } from '../audio/index.js';

/**
 * Removes a recording's licensed audio (R10, takedown-workflow §2): the final
 * step after the rights decision, so it is refused while any grant for the
 * recording is in force or suspended. Access ends in this transaction (the
 * source is tombstoned and the recording no longer points to it); the deletion
 * job then removes originals and derivatives from the catalog buckets.
 * Metadata, credits, relations and library/playlist references stay: the
 * recording reports `no_audio`. Whether contract end *requires* removal, its
 * deadline and any evidence retention are Legal items (open-questions RQ-01).
 */
export async function removeCatalogAudio(
  db: Db,
  operator: Principal,
  recordingId: string,
  reason: string,
  correlationId: string,
): Promise<{ recording_id: string; audio_source_id: string; status: 'deleting' }> {
  return db.transaction().execute(async (tx) => {
    const rec = await tx
      .selectFrom('recording')
      .select(['id', 'catalog_audio_source_id'])
      .where('id', '=', recordingId)
      .forUpdate()
      .executeTakeFirst();
    if (!rec) throw errors.notFound();
    const sourceId = rec.catalog_audio_source_id;
    if (!sourceId) throw errors.invalidState('This recording has no catalog audio to remove.');

    const blocking = await tx
      .selectFrom('rights_grant')
      .select('id')
      .where('recording_id', '=', recordingId)
      .where((eb) =>
        eb.or([
          eb('status', '=', 'suspended'),
          eb.and([
            eb('status', '=', 'active'),
            eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', sql<Date>`now()`)]),
          ]),
        ]),
      )
      .executeTakeFirst();
    if (blocking) {
      throw errors.invalidState(
        'A rights grant for this recording is still in force or suspended; revoke it first.',
      );
    }

    const source = await tx
      .selectFrom('audio_source')
      .select(['workspace_id'])
      .where('id', '=', sourceId)
      .executeTakeFirstOrThrow();
    await markDeleting(tx, sourceId, source.workspace_id, new Date(), correlationId);
    await tx
      .updateTable('recording')
      .set({ catalog_audio_source_id: null })
      .where('id', '=', recordingId)
      .execute();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'recording.audio_removed',
      subjectType: 'recording',
      subjectId: recordingId,
      reason,
      correlationId,
      details: { audio_source_id: sourceId },
    });
    return { recording_id: recordingId, audio_source_id: sourceId, status: 'deleting' as const };
  });
}
