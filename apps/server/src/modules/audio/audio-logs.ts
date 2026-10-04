import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { isUniqueViolation } from '../../platform/db/db.js';
import type { AudioLogTable } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';
import type { Principal } from '../../platform/http/principal.js';
import { newId } from '../../platform/ids.js';
import { getOwnSource } from './sources.js';

/** Checks that a catalog recording exists (catalog context); false when unknown. */
export type RecordingExists = (db: DbOrTx, recordingId: string) => Promise<boolean>;

const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));
TIME_ZONES.add('UTC');

export function isTimeZone(tz: string): boolean {
  return TIME_ZONES.has(tz);
}

type LogRow = Selectable<AudioLogTable> & { source_status: string };

export function audioLogView(l: LogRow) {
  return {
    audio_log_id: l.id,
    audio_source_id: l.audio_source_id,
    title: l.title,
    note: l.note,
    recorded_at: l.recorded_at.toISOString(),
    recorded_tz: l.recorded_tz,
    linked_recording_id: l.linked_recording_id,
    tags: l.tags,
    source_status: l.source_status,
    created_at: l.created_at.toISOString(),
  };
}

function logQuery(db: DbOrTx, principal: Principal) {
  return db
    .selectFrom('audio_log as l')
    .innerJoin('audio_source as s', 's.id', 'l.audio_source_id')
    .innerJoin('membership as m', 'm.workspace_id', 's.workspace_id')
    .selectAll('l')
    .select('s.status as source_status')
    .where('m.user_id', '=', principal.userId)
    .where('s.status', 'not in', ['deleting', 'deleted']);
}

export interface AudioLogInput {
  title: string;
  note?: string | null | undefined;
  recorded_at: string;
  recorded_tz: string;
  linked_recording_id?: string | null | undefined;
  tags?: string[] | undefined;
}

async function validateLink(
  ctx: AppContext,
  exists: RecordingExists,
  recordingId: string | null | undefined,
) {
  if (recordingId && !(await exists(ctx.db, recordingId))) {
    throw errors.unprocessable('UNPROCESSABLE', 'The linked recording does not exist.');
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0))];
}

/**
 * Attaches Audio Log metadata to an uploaded source of origin `audio_log` (LOG-001).
 * Audio Logs are private; there is no visibility field to change (LOG-002/009).
 */
export async function createAudioLog(
  ctx: AppContext,
  exists: RecordingExists,
  principal: Principal,
  input: AudioLogInput & { audio_source_id: string },
) {
  const source = await getOwnSource(ctx.db, principal, input.audio_source_id);
  if (source.origin !== 'audio_log') {
    throw errors.unprocessable(
      'UNPROCESSABLE',
      'Only audio uploaded as an Audio Log can carry Audio Log metadata.',
    );
  }
  if (source.status === 'deleting') throw errors.notFound();
  if (!isTimeZone(input.recorded_tz)) throw errors.validation({ recorded_tz: 'unknown time zone' });
  await validateLink(ctx, exists, input.linked_recording_id);
  try {
    await ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('audio_log')
        .values({
          id: newId('audioLog'),
          audio_source_id: source.id,
          author_user_id: principal.userId,
          title: input.title,
          note: input.note ?? null,
          recorded_at: input.recorded_at,
          recorded_tz: input.recorded_tz,
          linked_recording_id: input.linked_recording_id ?? null,
          tags: normalizeTags(input.tags),
        })
        .execute();
      // Keep the source title in sync so library listings show the log title.
      await tx
        .updateTable('audio_source')
        .set({ title: input.title, updated_at: new Date() })
        .where('id', '=', source.id)
        .execute();
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw errors.alreadyExists('This audio already has an Audio Log.');
    throw err;
  }
  const row = await logQuery(ctx.db, principal)
    .where('l.audio_source_id', '=', source.id)
    .executeTakeFirstOrThrow();
  return audioLogView(row);
}

export async function getAudioLog(db: DbOrTx, principal: Principal, id: string) {
  const row = await logQuery(db, principal).where('l.id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound();
  return audioLogView(row);
}

export async function updateAudioLog(
  ctx: AppContext,
  exists: RecordingExists,
  principal: Principal,
  id: string,
  patch: { [K in keyof AudioLogInput]?: AudioLogInput[K] | undefined },
) {
  const current = await logQuery(ctx.db, principal).where('l.id', '=', id).executeTakeFirst();
  if (!current) throw errors.notFound();
  if (patch.recorded_tz !== undefined && !isTimeZone(patch.recorded_tz)) {
    throw errors.validation({ recorded_tz: 'unknown time zone' });
  }
  if (patch.linked_recording_id !== undefined)
    await validateLink(ctx, exists, patch.linked_recording_id);
  await ctx.db.transaction().execute(async (tx) => {
    await tx
      .updateTable('audio_log')
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        // Correcting date/time never touches the audio version or its provenance (LOG-005).
        ...(patch.recorded_at !== undefined ? { recorded_at: patch.recorded_at } : {}),
        ...(patch.recorded_tz !== undefined ? { recorded_tz: patch.recorded_tz } : {}),
        ...(patch.linked_recording_id !== undefined
          ? { linked_recording_id: patch.linked_recording_id }
          : {}),
        ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    if (patch.title !== undefined) {
      await tx
        .updateTable('audio_source')
        .set({ title: patch.title, updated_at: new Date() })
        .where('id', '=', current.audio_source_id)
        .execute();
    }
  });
  return getAudioLog(ctx.db, principal, id);
}

export async function listAudioLogs(
  ctx: AppContext,
  principal: Principal,
  q: { limit: number; cursor?: string | undefined },
) {
  const scope = { userId: principal.userId, query: 'audio-logs' };
  const pos = ctx.cursors.decode(scope, q.cursor);
  let query = logQuery(ctx.db, principal);
  if (pos) {
    const [at, id] = pos as [string, string];
    query = query.where((eb) =>
      eb.or([
        eb('l.recorded_at', '<', new Date(at)),
        eb.and([eb('l.recorded_at', '=', new Date(at)), eb('l.id', '<', id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('l.recorded_at', 'desc')
    .orderBy('l.id', 'desc')
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map(audioLogView),
    next_cursor:
      rows.length > q.limit && last
        ? ctx.cursors.encode(scope, [last.recorded_at.toISOString(), last.id])
        : null,
  };
}
