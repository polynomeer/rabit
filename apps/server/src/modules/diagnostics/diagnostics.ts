import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../platform/db/db.js';
import { metrics } from '../../platform/metrics.js';

/**
 * Client diagnostics (ADR-0027): errors, crashes and hangs from the web and iOS
 * clients, grouped by a fingerprint the server computes, plus launch counts and web
 * vitals for metrics. Nothing links a report to the user who sent it.
 */
const errorKind = z.enum(['error', 'unhandled', 'crash', 'hang']);
const text = (max: number) => z.string().max(max * 4);

export const diagnosticsBatch = z.strictObject({
  platform: z.enum(['web', 'ios']),
  /** Build or marketing version; a label, so its shape is narrow. */
  app_version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/),
  /** App launches (iOS) or page loads (web) since the last batch. */
  launches: z.number().int().min(0).max(100).default(0),
  errors: z
    .array(
      z.strictObject({
        kind: errorKind,
        name: text(120),
        message: text(500),
        frames: z.array(text(300)).max(50),
        /** The same error repeated on the device before this batch. */
        count: z.number().int().min(1).max(1000).default(1),
      }),
    )
    .max(20)
    .default([]),
  /** Core Web Vitals of a page view (web only). */
  vitals: z
    .strictObject({
      lcp_ms: z.number().min(0).max(120_000).optional(),
      inp_ms: z.number().min(0).max(120_000).optional(),
      cls: z.number().min(0).max(100).optional(),
    })
    .optional(),
});
export type DiagnosticsBatch = z.infer<typeof diagnosticsBatch>;

/** New groups stop here; existing ones keep counting (flooding guard). */
export const MAX_GROUPS = 5_000;
/** Groups unseen this long are deleted. */
export const RETENTION_DAYS = 30;

/**
 * Removes what could identify a person or a resource from client text. Clients must
 * keep content out of messages; this is the safety net, and it also makes the same
 * error with different ids group together.
 */
export function scrub(s: string, max: number, opts: { numbers?: boolean } = {}): string {
  const out = s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b(https?:\/\/[^\s?#'")]+)[?#][^\s'")]*/g, '$1')
    .replace(/\b[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}\b/g, '<id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  // Messages may carry numbers a person typed; frames carry offsets that matter.
  return (opts.numbers === false ? out : out.replace(/\d{6,}/g, '<n>')).slice(0, max);
}

/**
 * Web line and column numbers change with every build: grouping ignores them. iOS
 * frames are binary offsets, which only mean something per build, so they stay.
 */
function frameKey(platform: string, frame: string): string {
  return platform === 'web' ? frame.replace(/:\d+(:\d+)?\)?$/, '') : frame;
}

export function fingerprint(
  platform: string,
  kind: string,
  name: string,
  frames: string[],
): string {
  const key = [platform, kind, name, ...frames.slice(0, 5).map((f) => frameKey(platform, f))].join(
    '\n',
  );
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export async function recordDiagnostics(db: Db, b: DiagnosticsBatch): Promise<void> {
  const platform = b.platform;
  if (b.launches > 0) metrics.clientLaunches.inc({ platform }, b.launches);
  if (b.vitals && platform === 'web') {
    if (b.vitals.lcp_ms !== undefined) metrics.webVitalsLcp.observe(b.vitals.lcp_ms / 1000);
    if (b.vitals.inp_ms !== undefined) metrics.webVitalsInp.observe(b.vitals.inp_ms / 1000);
    if (b.vitals.cls !== undefined) metrics.webVitalsCls.observe(b.vitals.cls);
  }
  for (const e of b.errors) {
    metrics.clientErrorsReported.inc({ platform, kind: e.kind }, e.count);
    const name = scrub(e.name, 120) || 'Error';
    const message = scrub(e.message, 500);
    const frames = e.frames.map((f) => scrub(f, 300, { numbers: false }));
    const fp = fingerprint(platform, e.kind, name, frames);
    const updated = await db
      .updateTable('client_error_group')
      .set({
        count: sql`count + ${e.count}`,
        last_app_version: b.app_version,
        last_seen_at: sql<Date>`now()`,
      })
      .where('fingerprint', '=', fp)
      .executeTakeFirst();
    if (updated.numUpdatedRows > 0n) continue;
    // Insert only below the cap, checked in the same statement.
    const inserted = await sql`
      INSERT INTO client_error_group
        (fingerprint, platform, kind, name, message, frames, count, first_app_version, last_app_version)
      SELECT ${fp}, ${platform}, ${e.kind}, ${name}, ${message}, ${JSON.stringify(frames)}::jsonb,
             ${e.count}, ${b.app_version}, ${b.app_version}
      WHERE (SELECT count(*) FROM client_error_group) < ${MAX_GROUPS}
      ON CONFLICT (fingerprint) DO UPDATE
        SET count = client_error_group.count + EXCLUDED.count,
            last_app_version = EXCLUDED.last_app_version,
            last_seen_at = now()`.execute(db);
    if ((inserted.numAffectedRows ?? 0n) === 0n) metrics.clientErrorGroupsDropped.inc({ platform });
  }
}

export async function errorGroups(
  db: Db,
  q: { platform?: 'web' | 'ios' | undefined; kind?: string | undefined; limit: number },
) {
  let query = db
    .selectFrom('client_error_group')
    .selectAll()
    .orderBy('last_seen_at', 'desc')
    .limit(q.limit);
  if (q.platform) query = query.where('platform', '=', q.platform);
  if (q.kind) query = query.where('kind', '=', q.kind as z.infer<typeof errorKind>);
  const rows = await query.execute();
  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    platform: r.platform,
    kind: r.kind,
    name: r.name,
    message: r.message,
    frames: r.frames,
    count: r.count,
    first_app_version: r.first_app_version,
    last_app_version: r.last_app_version,
    first_seen_at: r.first_seen_at.toISOString(),
    last_seen_at: r.last_seen_at.toISOString(),
  }));
}

export async function purgeErrorGroups(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const r = await db
    .deleteFrom('client_error_group')
    .where('last_seen_at', '<', cutoff)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
