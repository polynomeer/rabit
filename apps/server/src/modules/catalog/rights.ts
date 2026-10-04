import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { GrantStatus, RightsGrantTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { audit } from '../../platform/audit.js';

type GrantRow = Selectable<RightsGrantTable>;

export function grantView(g: GrantRow) {
  return {
    rights_grant_id: g.id,
    recording_id: g.recording_id,
    rights_holder: g.rights_holder,
    territories: g.territories,
    uses: g.uses,
    valid_from: g.valid_from.toISOString(),
    valid_to: g.valid_to?.toISOString() ?? null,
    status: g.status,
    contract_ref: g.contract_ref,
    version: g.version,
  };
}

/**
 * An active grant covering `use` in `territory` at `now` (ADR-0016 step 4).
 * `WORLD` covers every territory.
 */
export async function activeGrant(
  db: DbOrTx,
  recordingId: string,
  territory: string,
  use: GrantUse,
  now: Date,
): Promise<{ id: string; version: number } | null> {
  return (await activeGrants(db, [recordingId], territory, use, now)).get(recordingId) ?? null;
}

type GrantUse = 'stream' | 'download' | 'preview' | 'transform' | 'stem' | 'analysis';

/** {@link activeGrant} for many recordings in one query (review #6); the oldest grant wins. */
export async function activeGrants(
  db: DbOrTx,
  recordingIds: readonly string[],
  territory: string,
  use: GrantUse,
  now: Date,
): Promise<Map<string, { id: string; version: number }>> {
  const unique = [...new Set(recordingIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .selectFrom('rights_grant')
    .distinctOn('recording_id')
    .select(['recording_id', 'id', 'version'])
    .where('recording_id', 'in', unique)
    .where('status', '=', 'active')
    .where('valid_from', '<=', now)
    .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', now)]))
    .where(sql<boolean>`${use} = ANY(uses)`)
    .where(sql<boolean>`(${territory} = ANY(territories) OR 'WORLD' = ANY(territories))`)
    .orderBy('recording_id')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return new Map(rows.map((r) => [r.recording_id, { id: r.id, version: r.version }]));
}

async function emitChanged(db: DbOrTx, g: GrantRow, correlationId: string | null) {
  await emit(db, {
    type: 'RightsGrantChanged',
    schemaVersion: 1,
    subjectId: g.id,
    privacyScope: 'catalog',
    correlationId,
    payload: {
      rights_grant_id: g.id,
      recording_id: g.recording_id,
      version: g.version,
      status: g.status,
    },
  });
}

export interface CreateGrantInput {
  recording_id: string;
  rights_holder: string;
  territories: string[];
  uses: ('stream' | 'download' | 'preview' | 'transform' | 'stem' | 'analysis')[];
  valid_from: string;
  valid_to?: string | undefined;
  contract_ref: string;
}

export async function createGrant(
  db: DbOrTx,
  actor: { type: 'operator' | 'system'; id: string | null },
  input: CreateGrantInput,
  reason: string,
  correlationId: string | null,
) {
  const rec = await db
    .selectFrom('recording')
    .select('id')
    .where('id', '=', input.recording_id)
    .executeTakeFirst();
  if (!rec) throw errors.notFound();
  const g = await db
    .insertInto('rights_grant')
    .values({
      id: newId('rightsGrant'),
      recording_id: input.recording_id,
      rights_holder: input.rights_holder,
      territories: [...new Set(input.territories)],
      uses: [...new Set(input.uses)],
      valid_from: input.valid_from,
      valid_to: input.valid_to ?? null,
      status: 'active',
      contract_ref: input.contract_ref,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'rights_grant.created',
    subjectType: 'rights_grant',
    subjectId: g.id,
    reason,
    correlationId,
    details: { recording_id: g.recording_id, uses: g.uses, territories: g.territories },
  });
  await emitChanged(db, g, correlationId);
  return grantView(g);
}

const ALLOWED: Record<GrantStatus, GrantStatus[]> = {
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
  expired: [],
};

/** Status change with optimistic concurrency; revoked/expired are terminal (domain-model §3.3). */
export async function changeGrantStatus(
  db: Db,
  operator: Principal,
  id: string,
  expectedVersion: number,
  status: 'active' | 'suspended' | 'revoked',
  reason: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const g = await tx
      .selectFrom('rights_grant')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!g) throw errors.notFound();
    if (g.version !== expectedVersion) throw errors.preconditionFailed();
    if (!ALLOWED[g.status].includes(status)) {
      throw errors.invalidState(`A ${g.status} grant cannot become ${status}.`);
    }
    const updated = await tx
      .updateTable('rights_grant')
      .set({ status, version: g.version + 1, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: `rights_grant.${status}`,
      subjectType: 'rights_grant',
      subjectId: id,
      reason,
      correlationId,
      details: { from: g.status, to: status, version: updated.version },
    });
    await emitChanged(tx, updated, correlationId);
    return grantView(updated);
  });
}

/** Scheduled: active grants past `valid_to` become expired (and revoke sessions). */
export async function expireGrants(db: Db): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const rows = await tx
      .updateTable('rights_grant')
      .set((eb) => ({ status: 'expired', version: eb('version', '+', 1), updated_at: new Date() }))
      .where('status', 'in', ['active', 'suspended'])
      .where('valid_to', '<=', new Date())
      .returningAll()
      .execute();
    for (const g of rows) {
      await audit(tx, {
        actorType: 'system',
        actorId: null,
        action: 'rights_grant.expired',
        subjectType: 'rights_grant',
        subjectId: g.id,
      });
      await emitChanged(tx, g, null);
    }
    return rows.length;
  });
}
