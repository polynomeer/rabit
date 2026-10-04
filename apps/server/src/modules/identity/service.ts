import type { Config } from '../../platform/config.js';
import { isUniqueViolation, type Db, type DbOrTx } from '../../platform/db/db.js';
import { errors } from '../../platform/errors.js';
import { OPERATOR_ROLE, type VerifiedToken } from '../../platform/http/auth.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId, type Id } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { audit } from '../../platform/audit.js';

export const FREE_POLICY_ID = 'free_default';

export interface QuotaPolicy {
  id: string;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDurationMs: number;
  maxConcurrentUploads: number;
}

/** Plan policies are configuration (ACC-004, Q03), enforced server-side. */
export function quotaPolicy(config: Config, _policyId: string): QuotaPolicy {
  return { id: FREE_POLICY_ID, ...config.quota };
}

function toPrincipal(
  row: { id: string; status: string; workspace_id: string },
  token: VerifiedToken,
): Principal {
  return {
    userId: row.id as Id<'user'>,
    personalWorkspaceId: row.workspace_id as Id<'workspace'>,
    status: row.status === 'deletion_requested' ? 'deletion_requested' : 'active',
    // Operator requires both the role claim and MFA (NFR-SEC-007, T13).
    isOperator: token.roles.includes(OPERATOR_ROLE) && token.mfa,
  };
}

async function findByToken(db: DbOrTx, token: VerifiedToken) {
  return db
    .selectFrom('app_user as u')
    .innerJoin('workspace as w', (j) =>
      j.onRef('w.owner_user_id', '=', 'u.id').on('w.type', '=', 'personal'),
    )
    .select(['u.id', 'u.status', 'w.id as workspace_id'])
    .where('u.oidc_issuer', '=', token.issuer)
    .where('u.oidc_subject', '=', token.subject)
    .executeTakeFirst();
}

/**
 * Maps verified claims to a principal, provisioning the account and personal
 * workspace on first login in one transaction (ADR-0009). Concurrent first
 * requests are safe: the loser re-reads the winner's rows.
 */
export async function resolvePrincipal(db: Db, token: VerifiedToken): Promise<Principal> {
  const existing = await findByToken(db, token);
  if (existing) {
    if (existing.status === 'deleted') throw errors.unauthenticated();
    return toPrincipal(existing, token);
  }
  try {
    const created = await db.transaction().execute(async (tx) => {
      const userId = newId('user');
      const workspaceId = newId('workspace');
      await tx
        .insertInto('app_user')
        .values({
          id: userId,
          oidc_issuer: token.issuer,
          oidc_subject: token.subject,
          email_verified: token.emailVerified,
          license_country: null,
          deletion_requested_at: null,
        })
        .execute();
      await tx
        .insertInto('workspace')
        .values({
          id: workspaceId,
          type: 'personal',
          owner_user_id: userId,
          quota_policy_id: FREE_POLICY_ID,
        })
        .execute();
      await tx
        .insertInto('membership')
        .values({ workspace_id: workspaceId, user_id: userId, role: 'owner' })
        .execute();
      await audit(tx, {
        actorType: 'system',
        actorId: null,
        action: 'account.provisioned',
        subjectType: 'user',
        subjectId: userId,
      });
      return { id: userId, status: 'active', workspace_id: workspaceId };
    });
    return toPrincipal(created, token);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await findByToken(db, token);
    if (!winner) throw err;
    return toPrincipal(winner, token);
  }
}

export async function getUser(db: DbOrTx, userId: Id<'user'>) {
  return db.selectFrom('app_user').selectAll().where('id', '=', userId).executeTakeFirst();
}

/** Workspaces the user is a member of (MVP: the personal workspace). */
export async function workspaceIdsOf(db: DbOrTx, userId: Id<'user'>): Promise<Id<'workspace'>[]> {
  const rows = await db
    .selectFrom('membership')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .execute();
  return rows.map((r) => r.workspace_id as Id<'workspace'>);
}

export async function isWorkspaceMember(
  db: DbOrTx,
  userId: Id<'user'>,
  workspaceId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('membership')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  return row !== undefined;
}

/** Account deletion (privacy.md §2): blocks access now, deletes data asynchronously. */
export async function requestAccountDeletion(
  db: Db,
  principal: Principal,
  correlationId: string,
): Promise<{ user_id: string; state: 'requested' }> {
  await db.transaction().execute(async (tx) => {
    const res = await tx
      .updateTable('app_user')
      .set({
        status: 'deletion_requested',
        deletion_requested_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', principal.userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) return;
    await emit(tx, {
      type: 'AccountDeletionRequested',
      schemaVersion: 1,
      subjectId: principal.userId,
      workspaceId: principal.personalWorkspaceId,
      privacyScope: 'private',
      correlationId,
      payload: { user_id: principal.userId, workspace_id: principal.personalWorkspaceId },
    });
    await audit(tx, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'account.deletion_requested',
      subjectType: 'user',
      subjectId: principal.userId,
      correlationId,
    });
  });
  return { user_id: principal.userId, state: 'requested' };
}

export async function setLicenseCountry(
  db: Db,
  operator: Principal,
  userId: Id<'user'>,
  country: string,
  reason: string,
  correlationId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const res = await tx
      .updateTable('app_user')
      .set({ license_country: country, updated_at: new Date() })
      .where('id', '=', userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw errors.notFound();
    // Territory decides catalog rights: sessions issued under the old one end (review #12).
    await emit(tx, {
      type: 'LicenseCountryChanged',
      schemaVersion: 1,
      subjectId: userId,
      privacyScope: 'private',
      correlationId,
      payload: { user_id: userId },
    });
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'user.license_country_set',
      subjectType: 'user',
      subjectId: userId,
      reason,
      correlationId,
      details: { license_country: country },
    });
  });
}
