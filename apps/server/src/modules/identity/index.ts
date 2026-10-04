import type { Module } from '../../app/modules.js';
import { accountDeletionJob, type AccountDataDeleter } from './account-deletion.js';
import { identityRoutes, type MeProviders } from './routes.js';

export {
  resolvePrincipal,
  getUser,
  isWorkspaceMember,
  workspaceIdsOf,
  quotaPolicy,
  FREE_POLICY_ID,
  type QuotaPolicy,
} from './service.js';
export type { AccountDataDeleter } from './account-deletion.js';
export type { MeProviders } from './routes.js';

export function identityModule(deps: {
  me: MeProviders;
  /** Called in order during account deletion; each must be idempotent. */
  accountDeleters: () => AccountDataDeleter[];
}): Module {
  return {
    name: 'identity',
    routes: identityRoutes(deps.me),
    jobs: (ctx) => [accountDeletionJob(ctx, deps.accountDeleters())],
    subscriptions: { AccountDeletionRequested: ['identity.delete_account'] },
  };
}
