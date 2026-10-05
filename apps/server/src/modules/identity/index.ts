import type { Module } from '../../app/modules.js';
import { accountDeletionJob, type AccountDataDeleter } from './account-deletion.js';
import { identityRoutes, type MeProviders } from './routes.js';
import type { SupportSection } from '../../platform/support.js';
import type { Id } from '../../platform/ids.js';
import { getUser } from './service.js';

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

/** Support summary: account state only (no identity-provider subject or issuer). */
export const identitySupportSection: SupportSection = {
  name: 'account',
  async read(db, { userId }) {
    const u = await getUser(db, userId as Id<'user'>);
    if (!u) return {};
    return {
      status: u.status,
      license_country: u.license_country,
      email_verified: u.email_verified,
      created_at: u.created_at.toISOString(),
      deletion_requested_at: u.deletion_requested_at?.toISOString() ?? null,
    };
  },
};
