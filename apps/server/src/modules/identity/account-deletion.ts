import { createHash } from 'node:crypto';
import type { AppContext } from '../../app/context.js';
import type { Id } from '../../platform/ids.js';
import type { JobHandler } from '../../platform/jobs/runner.js';
import { audit } from '../../platform/audit.js';
import { z } from 'zod';

/** Each module that owns user data registers a deleter. Deleters must be idempotent. */
export type AccountDataDeleter = (
  ctx: AppContext,
  account: { userId: Id<'user'>; workspaceId: Id<'workspace'> },
) => Promise<void>;

const payload = z.object({ user_id: z.string(), workspace_id: z.string() });

export function accountDeletionJob(ctx: AppContext, deleters: AccountDataDeleter[]): JobHandler {
  return {
    kind: 'identity.delete_account',
    leaseMs: 10 * 60_000,
    async handle({ job }) {
      const p = payload.parse(job.payload);
      const account = {
        userId: p.user_id as Id<'user'>,
        workspaceId: p.workspace_id as Id<'workspace'>,
      };
      for (const del of deleters) await del(ctx, account);
      // Anonymize: the subject is replaced by a hash so the same OIDC identity can
      // register again as a new, empty account. No personal data remains on the row.
      await ctx.db.transaction().execute(async (tx) => {
        const user = await tx
          .selectFrom('app_user')
          .select(['oidc_subject', 'status'])
          .where('id', '=', account.userId)
          .executeTakeFirst();
        if (!user || user.status === 'deleted') return;
        await tx
          .updateTable('app_user')
          .set({
            status: 'deleted',
            oidc_subject: `deleted:${createHash('sha256').update(`${account.userId}:${user.oidc_subject}`).digest('hex')}`,
            license_country: null,
            updated_at: new Date(),
          })
          .where('id', '=', account.userId)
          .execute();
        await tx.deleteFrom('membership').where('user_id', '=', account.userId).execute();
        await audit(tx, {
          actorType: 'system',
          actorId: null,
          action: 'account.deleted',
          subjectType: 'user',
          subjectId: account.userId,
        });
      });
    },
  };
}
