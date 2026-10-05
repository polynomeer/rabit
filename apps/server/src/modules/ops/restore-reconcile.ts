import type { AppContext } from '../../app/context.js';
import { audit } from '../../platform/audit.js';
import { enqueue } from '../../platform/jobs/queue.js';
import type { Bucket } from '../../platform/storage/blob-store.js';
import { markDeleting } from '../audio/index.js';

export interface ReconcileReport {
  /** Accounts still `deletion_requested` in the backup: deletion queued again. */
  accountDeletionsRequeued: number;
  /** Sources tombstoned in the backup but not finished: deletion queued again. */
  sourceDeletionsRequeued: number;
  /** `ready` sources whose original is gone from storage: deleted after the backup. */
  orphanedSources: string[];
  /** Accounts whose every source was orphaned: possibly deleted after the backup (manual check). */
  accountsToReview: string[];
}

/**
 * Re-applies deletions after a database restore (R9, runbooks#backup-restore),
 * before traffic is opened. A restore must never bring back what a user or an
 * operator deleted (LIB-008, R10):
 *  1. deletions in flight at backup time are queued again (jobs are idempotent);
 *  2. sources deleted *after* the backup are found by their missing original in
 *     object storage (which is not rolled back with the database) and are
 *     tombstoned and deleted again; a catalog recording stops pointing to it.
 * Accounts deleted after the backup cannot be recognized from the database alone;
 * accounts left with only orphaned sources are reported for a manual check.
 * Safe to run more than once. `dryRun` reports without changing anything.
 */
export async function reconcileAfterRestore(
  ctx: AppContext,
  opts: { dryRun?: boolean; concurrency?: number } = {},
): Promise<ReconcileReport> {
  const dryRun = opts.dryRun ?? false;
  const report: ReconcileReport = {
    accountDeletionsRequeued: 0,
    sourceDeletionsRequeued: 0,
    orphanedSources: [],
    accountsToReview: [],
  };

  const pendingAccounts = await ctx.db
    .selectFrom('app_user as u')
    .innerJoin('workspace as w', (j) =>
      j.onRef('w.owner_user_id', '=', 'u.id').on('w.type', '=', 'personal'),
    )
    .select(['u.id as user_id', 'w.id as workspace_id'])
    .where('u.status', '=', 'deletion_requested')
    .execute();
  for (const a of pendingAccounts) {
    if (!dryRun) {
      await enqueue(ctx.db, {
        kind: 'identity.delete_account',
        payload: { user_id: a.user_id, workspace_id: a.workspace_id },
        dedupeKey: `restore-reconcile:account:${a.user_id}`,
      });
    }
    report.accountDeletionsRequeued += 1;
  }

  const tombstoned = await ctx.db
    .selectFrom('audio_source')
    .select('id')
    .where('deleted_at', 'is not', null)
    .where('status', '!=', 'deleted')
    .execute();
  for (const s of tombstoned) {
    if (!dryRun) await requeueSourceDeletion(ctx, s.id);
    report.sourceDeletionsRequeued += 1;
  }

  const ready = await ctx.db
    .selectFrom('audio_source as s')
    .innerJoin('audio_asset as a', 'a.audio_source_id', 's.id')
    .select(['s.id', 's.workspace_id', 'a.bucket', 'a.object_key'])
    .where('s.status', '=', 'ready')
    .where('s.deleted_at', 'is', null)
    .where('a.kind', '=', 'original')
    .execute();
  const missing: typeof ready = [];
  const concurrency = opts.concurrency ?? 16;
  for (let i = 0; i < ready.length; i += concurrency) {
    const batch = ready.slice(i, i + concurrency);
    const heads = await Promise.all(
      batch.map((r) => ctx.blobs.head(r.bucket as Bucket, r.object_key)),
    );
    batch.forEach((r, k) => {
      if (heads[k] === null) missing.push(r);
    });
  }
  for (const m of missing) {
    report.orphanedSources.push(m.id);
    if (dryRun) continue;
    await ctx.db.transaction().execute(async (tx) => {
      await markDeleting(tx, m.id, m.workspace_id, new Date(), null);
      const detached = await tx
        .updateTable('recording')
        .set({ catalog_audio_source_id: null })
        .where('catalog_audio_source_id', '=', m.id)
        .returning('id')
        .execute();
      await audit(tx, {
        actorType: 'system',
        actorId: null,
        action: 'source.deletion_reapplied',
        subjectType: 'audio_source',
        subjectId: m.id,
        reason: 'original missing from storage after a database restore',
        details: { recording_ids: detached.map((d) => d.id) },
      });
    });
    // markDeleting emits SourceDeletionRequested, which queues the deletion job.
  }

  if (missing.length > 0) {
    const workspaces = [...new Set(missing.map((m) => m.workspace_id))];
    const rows = await ctx.db
      .selectFrom('workspace as w')
      .innerJoin('app_user as u', 'u.id', 'w.owner_user_id')
      .select(['u.id as user_id', 'w.id as workspace_id'])
      .where('w.id', 'in', workspaces)
      .where('w.type', '=', 'personal')
      .where('u.status', '=', 'active')
      .execute();
    for (const r of rows) {
      const live = await ctx.db
        .selectFrom('audio_source')
        .select('id')
        .where('workspace_id', '=', r.workspace_id)
        .where('deleted_at', 'is', null)
        .where('id', 'not in', report.orphanedSources)
        .executeTakeFirst();
      if (!live) report.accountsToReview.push(r.user_id);
    }
  }
  return report;
}

async function requeueSourceDeletion(ctx: AppContext, sourceId: string) {
  await enqueue(ctx.db, {
    kind: 'audio.delete_source',
    payload: { audio_source_id: sourceId },
    dedupeKey: `restore-reconcile:source:${sourceId}`,
  });
}
