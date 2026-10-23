import type { DbOrTx } from '../../platform/db/db.js';
import { koreanDay, VALIDATION_TIME_ZONE } from '../../platform/validation.js';
import { sql } from 'kysely';

export interface CohortMember {
  userId: string;
  /** Sign-up day in Korea, `YYYY-MM-DD`. */
  signupDay: string;
}

/**
 * The people who signed up on `from`..`to` (Korean calendar days, inclusive) and are
 * still active (ADR-0031). Accounts from the operator issuer are left out.
 */
export async function validationCohort(
  db: DbOrTx,
  q: { from: string; to: string; operatorIssuer: string | undefined },
): Promise<CohortMember[]> {
  let query = db
    .selectFrom('app_user')
    .select(['id', koreanDay('created_at').as('signup_day')])
    .where('status', '=', 'active')
    .where(sql<string>`(created_at at time zone ${VALIDATION_TIME_ZONE})::date`, '>=', q.from)
    .where(sql<string>`(created_at at time zone ${VALIDATION_TIME_ZONE})::date`, '<=', q.to);
  if (q.operatorIssuer) query = query.where('oidc_issuer', '!=', q.operatorIssuer);
  const rows = await query.orderBy('created_at').execute();
  return rows.map((r) => ({ userId: r.id, signupDay: r.signup_day }));
}
