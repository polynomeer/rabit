import type { DbOrTx } from '../../platform/db/db.js';
import { newId } from '../../platform/ids.js';

/**
 * The audio side of a catalog recording (domain-model §3.1): object, version and a
 * public `catalog` source in the catalog workspace, created in the caller's
 * transaction while the catalog ingests its manifest. Processing follows as a job.
 */
export async function createCatalogSource(
  tx: DbOrTx,
  input: {
    sourceId: string;
    recordingId: string;
    workspaceId: string;
    sha256: string;
    storagePrefix: string;
  },
): Promise<void> {
  const objectId = newId('audioObject');
  const versionId = newId('audioVersion');
  await tx
    .insertInto('audio_object')
    .values({ id: objectId, kind: 'recording', current_version_id: versionId })
    .execute();
  await tx
    .insertInto('audio_version')
    .values({
      id: versionId,
      audio_object_id: objectId,
      version_no: 1,
      recording_id: input.recordingId,
      content_sha256: input.sha256,
      duration_ms: null,
      technical: JSON.stringify({}),
    })
    .execute();
  await tx
    .insertInto('audio_source')
    .values({
      id: input.sourceId,
      audio_version_id: versionId,
      workspace_id: input.workspaceId,
      origin: 'catalog',
      visibility: 'public',
      status: 'processing',
      title: null,
      created_by: null,
      failure_code: null,
      storage_prefix: input.storagePrefix,
      deleted_at: null,
    })
    .execute();
}

/** Processing gave up on a source still `processing` (dead-lettered job). */
export async function markSourceFailed(db: DbOrTx, sourceId: string, failureCode: string) {
  await db
    .updateTable('audio_source')
    .set({ status: 'failed', failure_code: failureCode, updated_at: new Date() })
    .where('id', '=', sourceId)
    .where('status', '=', 'processing')
    .execute();
}

/**
 * An operator retries a failed processing job: the source and its upload go back
 * to the state the job expects (ops retry).
 */
export async function resetSourceForRetry(tx: DbOrTx, sourceId: string) {
  await tx
    .updateTable('audio_source')
    .set({ status: 'processing', failure_code: null, updated_at: new Date() })
    .where('id', '=', sourceId)
    .where('status', '=', 'failed')
    .execute();
  await tx
    .updateTable('upload_session')
    .set({ state: 'quarantined', failure_code: null, updated_at: new Date() })
    .where('audio_source_id', '=', sourceId)
    .where('state', '=', 'failed')
    .execute();
}
