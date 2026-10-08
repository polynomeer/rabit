import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { EntitlementTable, GrantStatus, SubscriptionTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { audit } from '../../platform/audit.js';

type EntRow = Selectable<EntitlementTable>;
type SubRow = Selectable<SubscriptionTable>;

export function entitlementView(e: EntRow) {
  return {
    entitlement_id: e.id,
    scope: e.scope,
    resource_id: e.resource_id,
    capabilities: e.capabilities,
    origin: e.origin,
    status: e.status,
    valid_from: e.valid_from.toISOString(),
    valid_to: e.valid_to?.toISOString() ?? null,
    version: e.version,
  };
}

export function subscriptionView(s: SubRow | undefined) {
  return {
    subscription: s
      ? {
          subscription_id: s.id,
          plan: s.plan,
          state: s.state,
          paid_through: s.paid_through.toISOString(),
          source: s.source,
          auto_renew: s.auto_renew,
        }
      : null,
  };
}

async function emitChanged(db: DbOrTx, e: EntRow, correlationId: string | null) {
  await emit(db, {
    type: 'EntitlementChanged',
    schemaVersion: 1,
    subjectId: e.id,
    privacyScope: 'private',
    correlationId,
    payload: { entitlement_id: e.id, user_id: e.user_id, version: e.version, status: e.status },
  });
}

/**
 * The best active `play` entitlement for a recording now (ADR-0016 step 5).
 * Purchase/grant entitlements are preferred over the subscription for labelling.
 * Ownership, library membership and physical items never count.
 */
export async function activePlayEntitlement(
  db: DbOrTx,
  userId: string,
  recordingId: string,
  now: Date,
): Promise<PlayEntitlement | null> {
  return (await activePlayEntitlements(db, userId, [recordingId], now)).get(recordingId) ?? null;
}

type PlayEntitlement = { id: string; version: number; origin: EntRow['origin'] };

const ORIGIN_PRIORITY: Record<EntRow['origin'], number> = {
  purchase: 0,
  grant: 1,
  subscription: 2,
};

/**
 * {@link activePlayEntitlement} for many recordings with two queries regardless
 * of their number (review #6). Ties within one origin go to the lowest id so the
 * choice is stable between reads.
 */
export async function activePlayEntitlements(
  db: DbOrTx,
  userId: string,
  recordingIds: readonly string[],
  now: Date,
): Promise<Map<string, PlayEntitlement>> {
  const unique = [...new Set(recordingIds)];
  const out = new Map<string, PlayEntitlement>();
  if (unique.length === 0) return out;
  const tracks = await db
    .selectFrom('release_track')
    .select(['release_id', 'recording_id'])
    .where('recording_id', 'in', unique)
    .execute();
  const releaseIds = [...new Set(tracks.map((t) => t.release_id))];
  const ents = await db
    .selectFrom('entitlement as e')
    .select(['e.id', 'e.version', 'e.origin', 'e.scope', 'e.resource_id'])
    .where('e.user_id', '=', userId)
    .where('e.status', '=', 'active')
    .where('e.valid_from', '<=', now)
    .where((eb) => eb.or([eb('e.valid_to', 'is', null), eb('e.valid_to', '>', now)]))
    .where(sql<boolean>`'play' = ANY(e.capabilities)`)
    .where((eb) =>
      eb.or([
        eb('e.scope', '=', 'catalog_all'),
        eb.and([eb('e.scope', '=', 'recording'), eb('e.resource_id', 'in', unique)]),
        ...(releaseIds.length > 0
          ? [eb.and([eb('e.scope', '=', 'release'), eb('e.resource_id', 'in', releaseIds)])]
          : []),
      ]),
    )
    .execute();
  ents.sort(
    (x, y) => ORIGIN_PRIORITY[x.origin] - ORIGIN_PRIORITY[y.origin] || (x.id < y.id ? -1 : 1),
  );
  const releasesOf = new Map<string, Set<string>>();
  for (const t of tracks) {
    const set = releasesOf.get(t.recording_id) ?? new Set<string>();
    set.add(t.release_id);
    releasesOf.set(t.recording_id, set);
  }
  for (const rec of unique) {
    const best = ents.find(
      (e) =>
        e.scope === 'catalog_all' ||
        (e.scope === 'recording' && e.resource_id === rec) ||
        (e.scope === 'release' &&
          e.resource_id !== null &&
          releasesOf.get(rec)?.has(e.resource_id)),
    );
    if (best) out.set(rec, { id: best.id, version: best.version, origin: best.origin });
  }
  return out;
}

export async function listEntitlements(db: DbOrTx, userId: string) {
  const rows = await db
    .selectFrom('entitlement')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute();
  return { items: rows.map(entitlementView) };
}

export async function getSubscription(db: DbOrTx, userId: string) {
  return db.selectFrom('subscription').selectAll().where('user_id', '=', userId).executeTakeFirst();
}

export async function subscriptionState(db: DbOrTx, userId: string) {
  return (await getSubscription(db, userId))?.state ?? 'none';
}

/**
 * Operator/sandbox subscription state (ADR-0018: no payment provider yet). The
 * subscription is mirrored by one `catalog_all` entitlement whose status follows it;
 * `past_due` does not grant access (fail closed until a grace policy is decided).
 */
export async function setSubscription(
  db: Db,
  operator: Principal,
  userId: string,
  input: { plan: string; state: SubRow['state']; paid_through: string; reason: string },
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('app_user')
      .select(['id', 'status'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status !== 'active') throw errors.notFound();
    const sub = await tx
      .insertInto('subscription')
      .values({
        id: newId('subscription'),
        user_id: userId,
        plan: input.plan,
        state: input.state,
        paid_through: input.paid_through,
        source: 'operator',
        auto_renew: false,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet((eb) => ({
          plan: input.plan,
          state: input.state,
          paid_through: input.paid_through,
          source: 'operator',
          auto_renew: false,
          version: eb('subscription.version', '+', 1),
          updated_at: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    const active = input.state === 'active' && new Date(input.paid_through) > new Date();
    const status: GrantStatus = active
      ? 'active'
      : input.state === 'past_due'
        ? 'suspended'
        : 'expired';
    const ent = await tx
      .insertInto('entitlement')
      .values({
        id: newId('entitlement'),
        user_id: userId,
        scope: 'catalog_all',
        resource_id: null,
        capabilities: ['play'],
        origin: 'subscription',
        origin_ref: sub.id,
        valid_to: input.paid_through,
        status,
      })
      .onConflict((oc) =>
        oc
          .column('user_id')
          .where('origin', '=', 'subscription')
          .doUpdateSet((eb) => ({
            status,
            valid_to: input.paid_through,
            origin_ref: sub.id,
            version: eb('entitlement.version', '+', 1),
            updated_at: new Date(),
          })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'subscription.set',
      subjectType: 'user',
      subjectId: userId,
      reason: input.reason,
      correlationId,
      details: { state: input.state, entitlement_status: status },
    });
    await emitChanged(tx, ent, correlationId);
    return subscriptionView(sub);
  });
}

export async function grantEntitlement(
  db: Db,
  operator: Principal,
  input: {
    user_id: string;
    scope: 'release' | 'recording';
    resource_id: string;
    capabilities: string[];
    valid_to?: string | undefined;
    reason: string;
  },
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('app_user')
      .select('status')
      .where('id', '=', input.user_id)
      .executeTakeFirst();
    if (!user || user.status !== 'active') throw errors.notFound();
    const resource = await tx
      .selectFrom('music_entity')
      .select('entity_type')
      .where('id', '=', input.resource_id)
      .executeTakeFirst();
    if (!resource || resource.entity_type !== input.scope) throw errors.notFound();
    const e = await tx
      .insertInto('entitlement')
      .values({
        id: newId('entitlement'),
        user_id: input.user_id,
        scope: input.scope,
        resource_id: input.resource_id,
        capabilities: [...new Set(input.capabilities)],
        origin: 'grant',
        origin_ref: `operator:${operator.userId}`,
        valid_to: input.valid_to ?? null,
        status: 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'entitlement.granted',
      subjectType: 'entitlement',
      subjectId: e.id,
      reason: input.reason,
      correlationId,
      details: { user_id: input.user_id, scope: input.scope, resource_id: input.resource_id },
    });
    await emitChanged(tx, e, correlationId);
    return entitlementView(e);
  });
}

const ALLOWED: Record<GrantStatus, GrantStatus[]> = {
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
  expired: [],
};

export async function changeEntitlementStatus(
  db: Db,
  operator: Principal,
  id: string,
  expectedVersion: number,
  status: 'active' | 'suspended' | 'revoked',
  reason: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const e = await tx
      .selectFrom('entitlement')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!e) throw errors.notFound();
    if (e.origin === 'subscription') {
      throw errors.invalidState(
        'Subscription entitlements follow the subscription; change the subscription instead.',
      );
    }
    if (e.version !== expectedVersion) throw errors.preconditionFailed();
    if (!ALLOWED[e.status].includes(status))
      throw errors.invalidState(`A ${e.status} entitlement cannot become ${status}.`);
    const updated = await tx
      .updateTable('entitlement')
      .set({ status, version: e.version + 1, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: `entitlement.${status}`,
      subjectType: 'entitlement',
      subjectId: id,
      reason,
      correlationId,
      details: { from: e.status, to: status },
    });
    await emitChanged(tx, updated, correlationId);
    return entitlementView(updated);
  });
}

/** Scheduled: expire lapsed subscriptions and entitlements (revokes sessions via events). */
export async function expireEntitlements(db: Db): Promise<number> {
  return db.transaction().execute(async (tx) => {
    await tx
      .updateTable('subscription')
      .set((eb) => ({ state: 'expired', version: eb('version', '+', 1), updated_at: new Date() }))
      .where('state', 'in', ['active', 'past_due'])
      .where('paid_through', '<=', new Date())
      .execute();
    const rows = await tx
      .updateTable('entitlement')
      .set((eb) => ({ status: 'expired', version: eb('version', '+', 1), updated_at: new Date() }))
      .where('status', 'in', ['active', 'suspended'])
      .where('valid_to', '<=', new Date())
      .returningAll()
      .execute();
    for (const e of rows) await emitChanged(tx, e, null);
    return rows.length;
  });
}

/**
 * Entitlement for a fulfilled purchase (COM-006, COM-016), written in the caller's
 * transaction with the order and ledger changes. Independent of the subscription:
 * cancelling one never touches the other (COM-001, COM-009).
 */
export async function issuePurchaseEntitlement(
  tx: DbOrTx,
  input: { userId: string; releaseId: string; capabilities: string[]; orderId: string },
  correlationId: string | null,
): Promise<string> {
  const e = await tx
    .insertInto('entitlement')
    .values({
      id: newId('entitlement'),
      user_id: input.userId,
      scope: 'release',
      resource_id: input.releaseId,
      capabilities: [...new Set(input.capabilities)],
      origin: 'purchase',
      origin_ref: input.orderId,
      valid_to: null,
      status: 'active',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await emitChanged(tx, e, correlationId);
  return e.id;
}

/** Revokes a purchase entitlement after a refund; active sessions end through the event. */
export async function revokePurchaseEntitlement(
  tx: DbOrTx,
  entitlementId: string,
  correlationId: string | null,
): Promise<void> {
  const e = await tx
    .updateTable('entitlement')
    .set((eb) => ({ status: 'revoked', version: eb('version', '+', 1), updated_at: new Date() }))
    .where('id', '=', entitlementId)
    .where('origin', '=', 'purchase')
    .where('status', 'in', ['active', 'suspended'])
    .returningAll()
    .executeTakeFirst();
  if (e) await emitChanged(tx, e, correlationId);
}

/** Same day next month(s), clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** Mirrors the subscription into its single `catalog_all` entitlement. */
async function syncSubscriptionEntitlement(
  tx: DbOrTx,
  sub: SubRow,
  status: GrantStatus,
  correlationId: string | null,
) {
  const ent = await tx
    .insertInto('entitlement')
    .values({
      id: newId('entitlement'),
      user_id: sub.user_id,
      scope: 'catalog_all',
      resource_id: null,
      capabilities: ['play'],
      origin: 'subscription',
      origin_ref: sub.id,
      valid_to: sub.paid_through,
      status,
    })
    .onConflict((oc) =>
      oc
        .column('user_id')
        .where('origin', '=', 'subscription')
        .doUpdateSet((eb) => ({
          status,
          valid_to: sub.paid_through,
          origin_ref: sub.id,
          version: eb('entitlement.version', '+', 1),
          updated_at: new Date(),
        })),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await emitChanged(tx, ent, correlationId);
  return ent;
}

/**
 * A paid subscription period (COM-008): the period starts at the later of now
 * and the current paid-through date, and the subscription renews until the user
 * stops it. Runs in the caller's transaction with the order and the ledger.
 */
export async function activateSubscriptionPeriod(
  tx: DbOrTx,
  input: { userId: string; plan: string; months: number },
  correlationId: string | null,
): Promise<string> {
  const now = new Date();
  const current = await tx
    .selectFrom('subscription')
    .selectAll()
    .where('user_id', '=', input.userId)
    .forUpdate()
    .executeTakeFirst();
  const base =
    current && ['active', 'past_due'].includes(current.state) && current.paid_through > now
      ? current.paid_through
      : now;
  const paidThrough = addMonths(base, input.months);
  const sub = await tx
    .insertInto('subscription')
    .values({
      id: newId('subscription'),
      user_id: input.userId,
      plan: input.plan,
      state: 'active',
      paid_through: paidThrough,
      source: 'sandbox',
      auto_renew: true,
    })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet((eb) => ({
        plan: input.plan,
        state: 'active',
        paid_through: paidThrough,
        source: 'sandbox',
        auto_renew: true,
        version: eb('subscription.version', '+', 1),
        updated_at: now,
      })),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  return (await syncSubscriptionEntitlement(tx, sub, 'active', correlationId)).id;
}

/** A renewal payment failed: no access until paid (fail closed, as for `past_due`). */
export async function markSubscriptionPastDue(
  tx: DbOrTx,
  userId: string,
  correlationId: string | null,
): Promise<void> {
  const sub = await tx
    .updateTable('subscription')
    .set((eb) => ({ state: 'past_due', version: eb('version', '+', 1), updated_at: new Date() }))
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .returningAll()
    .executeTakeFirst();
  if (sub) await syncSubscriptionEntitlement(tx, sub, 'suspended', correlationId);
}

/** Immediate end after a refund: access stops now and nothing renews. */
export async function endSubscriptionNow(
  tx: DbOrTx,
  userId: string,
  correlationId: string | null,
): Promise<void> {
  const sub = await tx
    .updateTable('subscription')
    .set((eb) => ({
      state: 'cancelled',
      paid_through: new Date(),
      auto_renew: false,
      version: eb('version', '+', 1),
      updated_at: new Date(),
    }))
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  if (sub) await syncSubscriptionEntitlement(tx, sub, 'expired', correlationId);
}

/**
 * Stops automatic renewal; access continues until the paid-through date and
 * then expires (COM-008: stopping renewal is not a refund).
 */
export async function stopSubscriptionRenewal(tx: DbOrTx, userId: string) {
  const sub = await tx
    .updateTable('subscription')
    .set((eb) => ({ auto_renew: false, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('user_id', '=', userId)
    .where('auto_renew', '=', true)
    .returningAll()
    .executeTakeFirst();
  return subscriptionView(sub ?? (await getSubscription(tx, userId)));
}

/** Turns renewal back on for a paid, still active sandbox subscription. */
export async function resumeSubscriptionRenewal(tx: DbOrTx, userId: string) {
  const sub = await tx
    .updateTable('subscription')
    .set((eb) => ({ auto_renew: true, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .where('source', '=', 'sandbox')
    .where('auto_renew', '=', false)
    .returningAll()
    .executeTakeFirst();
  return sub ? subscriptionView(sub) : null;
}
