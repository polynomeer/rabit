import type { Db, DbOrTx } from '../../platform/db/db.js';
import type { IntegrityAxis } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { audit } from '../../platform/audit.js';
import { creditsOf, entitySummaries } from '../catalog/index.js';

export const STAGES = [
  'composition',
  'lyrics',
  'vocals',
  'instruments',
  'mixing',
  'mastering',
  'artwork',
] as const;

/**
 * Music Passport (TRU-001..004, ADR-0017). Each creation stage shows its own
 * method, verification state and basis; stages without a claim are `unknown`
 * (never assumed human). Integrity axes are listed separately with their basis;
 * internal model scores are never exposed (TRU-007, PB Phase 16). No "Human
 * Verified" badge exists until its criteria are decided (Q08).
 */
export async function passport(db: DbOrTx, recordingId: string, apiBase: string) {
  const rec = await db
    .selectFrom('recording')
    .select('id')
    .where('id', '=', recordingId)
    .executeTakeFirst();
  if (!rec) throw errors.notFound();
  const claims = await db
    .selectFrom('provenance_claim')
    .selectAll()
    .where('subject_entity_id', '=', recordingId)
    .orderBy('created_at')
    .execute();
  const credits = await creditsOf(db, recordingId);
  const latestByAxis = await db
    .selectFrom('integrity_signal')
    .select(['axis', 'value', 'basis', 'created_at'])
    .where('subject_entity_id', '=', recordingId)
    .orderBy('created_at', 'desc')
    .execute();
  const seen = new Set<IntegrityAxis>();
  const integrity = latestByAxis.filter((s) =>
    seen.has(s.axis) ? false : (seen.add(s.axis), true),
  );

  return {
    recording_id: recordingId,
    creation: STAGES.map((stage) => {
      const c = [...claims]
        .reverse()
        .find((x) => x.claim_type === 'creation_method' && x.stage === stage);
      return c
        ? { stage, method: c.value, verification_state: c.verification_state, basis: c.basis }
        : { stage, method: 'unknown', verification_state: null, basis: null };
    }),
    credits: credits.map((c) => ({
      credit_id: c.id,
      contributor: { entity_id: c.contributor_id, name: c.contributor_name },
      role: c.role,
      instrument: c.instrument,
      creation_method: c.creation_method,
      basis: c.basis,
      verification_state: c.verification_state,
      source: c.source,
    })),
    claims: claims.map((c) => ({
      claim_type: c.claim_type,
      value: c.value,
      issuer: c.issuer,
      verification_state: c.verification_state,
      basis: c.basis,
    })),
    integrity: integrity.map((s) => ({ axis: s.axis, value: s.value, basis: s.basis })),
    report_url: `${apiBase}/v1/reports`,
  };
}

async function subjectExists(db: DbOrTx, type: string, id: string): Promise<boolean> {
  if (type === 'relation') {
    return (
      (await db
        .selectFrom('music_relation')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()) !== undefined
    );
  }
  if (type === 'credit') {
    return (
      (await db.selectFrom('credit').select('id').where('id', '=', id).executeTakeFirst()) !==
      undefined
    );
  }
  const e = (await entitySummaries(db, [id])).get(id);
  return e?.entity_type === type;
}

/**
 * User reports (TRU-009). A report never changes catalog data or availability by
 * itself (T21/A04): it enters a triage queue for people to review.
 */
export async function submitReport(
  db: Db,
  principal: Principal,
  input: {
    subject_type: 'recording' | 'release' | 'artist' | 'relation' | 'credit';
    subject_id: string;
    reason_code: string;
    details?: string | undefined;
  },
  correlationId: string,
) {
  if (!(await subjectExists(db, input.subject_type, input.subject_id))) throw errors.notFound();
  return db.transaction().execute(async (tx) => {
    const r = await tx
      .insertInto('report')
      .values({
        id: newId('report'),
        reporter_user_id: principal.userId,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        reason_code: input.reason_code as never,
        details: input.details ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emit(tx, {
      type: 'ReportReceived',
      schemaVersion: 1,
      subjectId: r.id,
      privacyScope: 'system',
      correlationId,
      payload: { report_id: r.id, subject_type: r.subject_type, reason_code: r.reason_code },
    });
    return { report_id: r.id, status: r.status, created_at: r.created_at.toISOString() };
  });
}

export async function listReports(db: DbOrTx, status: string | undefined, limit: number) {
  let q = db.selectFrom('report').selectAll().orderBy('created_at').limit(limit);
  if (status) q = q.where('status', '=', status as never);
  const rows = await q.execute();
  // Reporter identity stays internal to the operator view; details may be personal text.
  return {
    items: rows.map((r) => ({
      report_id: r.id,
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      reason_code: r.reason_code,
      details: r.details,
      status: r.status,
      created_at: r.created_at.toISOString(),
    })),
  };
}

const NEXT: Record<string, string[]> = {
  received: ['triaged', 'dismissed'],
  triaged: ['actioned', 'dismissed'],
  actioned: [],
  dismissed: [],
};

export async function changeReportStatus(
  db: Db,
  operator: Principal,
  id: string,
  status: 'triaged' | 'actioned' | 'dismissed',
  reason: string,
  correlationId: string,
) {
  return db.transaction().execute(async (tx) => {
    const r = await tx
      .selectFrom('report')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!r) throw errors.notFound();
    if (!NEXT[r.status]?.includes(status))
      throw errors.invalidState(`A ${r.status} report cannot become ${status}.`);
    await tx
      .updateTable('report')
      .set({ status, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: `report.${status}`,
      subjectType: 'report',
      subjectId: id,
      reason,
      correlationId,
      details: { from: r.status, to: status },
    });
    return { report_id: id, status, created_at: r.created_at.toISOString() };
  });
}

/**
 * Records an integrity decision on one axis. Operator decisions are `reviewed`;
 * automated detector output may be stored but never excludes anything alone
 * (TRU-008: no sanction on a detector score only).
 */
export async function recordSignal(
  db: Db,
  operator: Principal,
  input: { subject_entity_id: string; axis: IntegrityAxis; value: string; reason: string },
  correlationId: string,
) {
  const e = (await entitySummaries(db, [input.subject_entity_id])).get(input.subject_entity_id);
  if (!e) throw errors.notFound();
  return db.transaction().execute(async (tx) => {
    const s = await tx
      .insertInto('integrity_signal')
      .values({
        id: newId('integritySignal'),
        subject_entity_id: input.subject_entity_id,
        axis: input.axis,
        value: input.value,
        basis: 'reviewed',
        internal_score: null,
        model_version: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, {
      actorType: 'operator',
      actorId: operator.userId,
      action: 'integrity.signal_recorded',
      subjectType: e.entity_type,
      subjectId: e.entity_id,
      reason: input.reason,
      correlationId,
      details: { axis: input.axis, value: input.value },
    });
    return { axis: s.axis, value: s.value, basis: s.basis };
  });
}

/**
 * DIG/recommendation eligibility (DIG-020): only the latest *reviewed* decision
 * on `recommendation_eligibility` can exclude an entity. AI generation, quality
 * and automated spam scores alone never exclude (TRU-007/008).
 */
export async function excludedEntities(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom('integrity_signal')
    .select(['subject_entity_id', 'value', 'created_at'])
    .where('subject_entity_id', 'in', ids)
    .where('axis', '=', 'recommendation_eligibility')
    .where('basis', '=', 'reviewed')
    .orderBy('created_at', 'desc')
    .execute();
  const latest = new Map<string, string>();
  for (const r of rows)
    if (!latest.has(r.subject_entity_id)) latest.set(r.subject_entity_id, r.value);
  return new Set([...latest].filter(([, v]) => v === 'excluded').map(([k]) => k));
}
