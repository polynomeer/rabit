import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileAfterRestore } from '../src/modules/ops/restore-reconcile.js';
import type { Bucket } from '../src/platform/storage/blob-store.js';
import { fixtures } from './helpers/audio-fixtures.js';
import { seedCatalog } from './helpers/catalog.js';
import { createHarness, uploadReady, type Harness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** Simulates a deletion that happened after the backup: storage is gone, the restored row is not. */
async function removeObjectsOf(sourceId: string) {
  const assets = await h.ctx.db
    .selectFrom('audio_asset')
    .select(['bucket', 'object_key'])
    .where('audio_source_id', '=', sourceId)
    .execute();
  for (const a of assets) await h.ctx.blobs.delete(a.bucket as Bucket, a.object_key);
}

const sourceRow = (id: string) =>
  h.ctx.db
    .selectFrom('audio_source')
    .select(['status', 'deleted_at', 'title'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

describe('re-applying deletions after a database restore (R9)', () => {
  it('deletes again a private source that was deleted after the backup', async () => {
    const u = await h.user();
    const gone = await uploadReady(h, u, fixtures.wav(), { filename: 'gone.wav' });
    const kept = await uploadReady(h, u, fixtures.wav(), { filename: 'kept.wav' });
    await removeObjectsOf(gone);

    const dry = await reconcileAfterRestore(h.ctx, { dryRun: true });
    expect(dry.orphanedSources).toContain(gone);
    expect((await sourceRow(gone)).status).toBe('ready');

    const report = await reconcileAfterRestore(h.ctx);
    expect(report.orphanedSources).toContain(gone);
    expect(report.orphanedSources).not.toContain(kept);
    // Access ends at once, before the job runs.
    expect((await sourceRow(gone)).status).toBe('deleting');
    await h.worker.drain();
    expect(await sourceRow(gone)).toMatchObject({ status: 'deleted', title: null });
    expect((await sourceRow(kept)).status).toBe('ready');
    const audit = await h.ctx.db
      .selectFrom('audit_log')
      .select(['action', 'actor_type'])
      .where('subject_id', '=', gone)
      .execute();
    expect(audit).toContainEqual({ action: 'source.deletion_reapplied', actor_type: 'system' });
  });

  it('queues again deletions that were in flight at backup time', async () => {
    const u = await h.user();
    const src = await uploadReady(h, u, fixtures.wav());
    // Tombstoned in the backup, but its deletion job was never run.
    await h.ctx.db
      .updateTable('audio_source')
      .set({ status: 'deleting', deleted_at: new Date() })
      .where('id', '=', src)
      .execute();
    await h.ctx.db
      .updateTable('app_user')
      .set({ status: 'deletion_requested', deletion_requested_at: new Date() })
      .where('id', '=', u.userId)
      .execute();

    const report = await reconcileAfterRestore(h.ctx);
    expect(report.sourceDeletionsRequeued).toBeGreaterThanOrEqual(1);
    expect(report.accountDeletionsRequeued).toBeGreaterThanOrEqual(1);
    await h.worker.drain();
    expect((await sourceRow(src)).status).toBe('deleted');
    const user = await h.ctx.db
      .selectFrom('app_user')
      .select('status')
      .where('id', '=', u.userId)
      .executeTakeFirstOrThrow();
    expect(user.status).toBe('deleted');

    // Running it again changes nothing.
    const again = await reconcileAfterRestore(h.ctx);
    expect(again.orphanedSources).toEqual([]);
  });

  it('detaches catalog audio removed after the backup and reports emptied accounts', async () => {
    const cat = await seedCatalog(h);
    const src = cat.sources['r1']!;
    await removeObjectsOf(src);
    const u = await h.user();
    const only = await uploadReady(h, u, fixtures.wav());
    await removeObjectsOf(only);

    const report = await reconcileAfterRestore(h.ctx);
    expect(report.orphanedSources).toEqual(expect.arrayContaining([src, only]));
    expect(report.accountsToReview).toContain(u.userId);
    const rec = await h.ctx.db
      .selectFrom('recording')
      .select('catalog_audio_source_id')
      .where('id', '=', cat.ids['r1']!)
      .executeTakeFirstOrThrow();
    expect(rec.catalog_audio_source_id).toBeNull();
    await h.worker.drain();
    expect((await sourceRow(src)).status).toBe('deleted');
  });
});
