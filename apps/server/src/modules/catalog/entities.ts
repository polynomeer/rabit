import type { DbOrTx } from '../../platform/db/db.js';
import type { EntityType } from '../../platform/db/schema.js';
import { errors } from '../../platform/errors.js';

export interface EntitySummary {
  entity_id: string;
  entity_type: EntityType;
  name: string;
  subtitle: string | null;
}

/** Ordered artist names for recordings/releases, keyed by subject id. */
async function artistNames(db: DbOrTx, kind: 'recording' | 'release', ids: string[]) {
  if (ids.length === 0) return new Map<string, { entity_id: string; name: string }[]>();
  const rows =
    kind === 'recording'
      ? await db
          .selectFrom('recording_artist as ra')
          .innerJoin('music_entity as e', 'e.id', 'ra.artist_id')
          .select(['ra.recording_id as subject', 'e.id', 'e.display_name', 'ra.ord'])
          .where('ra.recording_id', 'in', ids)
          .orderBy('ra.ord')
          .execute()
      : await db
          .selectFrom('release_artist as ra')
          .innerJoin('music_entity as e', 'e.id', 'ra.artist_id')
          .select(['ra.release_id as subject', 'e.id', 'e.display_name', 'ra.ord'])
          .where('ra.release_id', 'in', ids)
          .orderBy('ra.ord')
          .execute();
  const out = new Map<string, { entity_id: string; name: string }[]>();
  for (const r of rows) {
    const list = out.get(r.subject) ?? [];
    list.push({ entity_id: r.id, name: r.display_name });
    out.set(r.subject, list);
  }
  return out;
}

export async function artistsOf(db: DbOrTx, kind: 'recording' | 'release', id: string) {
  return (await artistNames(db, kind, [id])).get(id) ?? [];
}

/** Summaries for any catalog entities, with a subtitle (artists) for recordings/releases. */
export async function entitySummaries(
  db: DbOrTx,
  ids: string[],
): Promise<Map<string, EntitySummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .selectFrom('music_entity')
    .select(['id', 'entity_type', 'display_name'])
    .where('id', 'in', unique)
    .execute();
  const recs = rows.filter((r) => r.entity_type === 'recording').map((r) => r.id);
  const rels = rows.filter((r) => r.entity_type === 'release').map((r) => r.id);
  const [ra, la] = await Promise.all([
    artistNames(db, 'recording', recs),
    artistNames(db, 'release', rels),
  ]);
  const out = new Map<string, EntitySummary>();
  for (const r of rows) {
    const artists =
      r.entity_type === 'recording'
        ? ra.get(r.id)
        : r.entity_type === 'release'
          ? la.get(r.id)
          : undefined;
    out.set(r.id, {
      entity_id: r.id,
      entity_type: r.entity_type,
      name: r.display_name,
      subtitle: artists && artists.length > 0 ? artists.map((a) => a.name).join(', ') : null,
    });
  }
  return out;
}

export async function entitySummary(db: DbOrTx, id: string): Promise<EntitySummary> {
  const s = (await entitySummaries(db, [id])).get(id);
  if (!s) throw errors.notFound();
  return s;
}

export async function recordingExists(db: DbOrTx, id: string): Promise<boolean> {
  return (
    (await db.selectFrom('recording').select('id').where('id', '=', id).executeTakeFirst()) !==
    undefined
  );
}

export async function releaseExists(db: DbOrTx, id: string): Promise<boolean> {
  return (
    (await db.selectFrom('release').select('id').where('id', '=', id).executeTakeFirst()) !==
    undefined
  );
}

/** The catalog audio source for a recording, if the recording has licensed audio ingested. */
export async function recordingSource(db: DbOrTx, recordingId: string): Promise<string | null> {
  const r = await db
    .selectFrom('recording')
    .select('catalog_audio_source_id')
    .where('id', '=', recordingId)
    .executeTakeFirst();
  return r?.catalog_audio_source_id ?? null;
}

export async function getRecording(db: DbOrTx, id: string) {
  const rec = await db.selectFrom('recording').selectAll().where('id', '=', id).executeTakeFirst();
  if (!rec) throw errors.notFound();
  const releases = await db
    .selectFrom('release_track as t')
    .innerJoin('release as r', 'r.id', 't.release_id')
    .select(['r.id as release_id', 'r.title'])
    .where('t.recording_id', '=', id)
    .distinct()
    .execute();
  return {
    recording_id: rec.id,
    title: rec.title,
    artists: await artistsOf(db, 'recording', id),
    duration_ms: rec.duration_ms,
    isrc: rec.isrc,
    releases,
    catalog_audio_source_id: rec.catalog_audio_source_id,
  };
}

export async function getRelease(db: DbOrTx, id: string) {
  const rel = await db.selectFrom('release').selectAll().where('id', '=', id).executeTakeFirst();
  if (!rel) throw errors.notFound();
  const tracks = await db
    .selectFrom('release_track as t')
    .innerJoin('recording as r', 'r.id', 't.recording_id')
    .select([
      't.disc_no',
      't.position',
      'r.id as recording_id',
      'r.title',
      'r.duration_ms',
      'r.catalog_audio_source_id',
    ])
    .where('t.release_id', '=', id)
    .orderBy('t.disc_no')
    .orderBy('t.position')
    .execute();
  const label = rel.label_id ? await entitySummary(db, rel.label_id) : null;
  return {
    release_id: rel.id,
    title: rel.title,
    release_type: rel.release_type,
    artists: await artistsOf(db, 'release', id),
    label: label ? { entity_id: label.entity_id, name: label.name } : null,
    release_date: rel.release_date,
    tracks,
  };
}

export async function creditsOf(db: DbOrTx, subjectId: string) {
  return db
    .selectFrom('credit as c')
    .innerJoin('music_entity as e', 'e.id', 'c.contributor_entity_id')
    .select([
      'c.id',
      'c.role',
      'c.instrument',
      'c.creation_method',
      'c.basis',
      'c.verification_state',
      'c.source',
      'e.id as contributor_id',
      'e.display_name as contributor_name',
    ])
    .where('c.subject_entity_id', '=', subjectId)
    .orderBy('c.role')
    .orderBy('e.sort_name')
    .execute();
}

/** The single system workspace that owns catalog sources (domain-model §3.1). */
export async function ensureCatalogWorkspace(
  db: DbOrTx,
  newWorkspaceId: () => string,
): Promise<string> {
  const existing = await db
    .selectFrom('workspace')
    .select('id')
    .where('type', '=', 'catalog')
    .executeTakeFirst();
  if (existing) return existing.id;
  await db
    .insertInto('workspace')
    .values({
      id: newWorkspaceId(),
      type: 'catalog',
      owner_user_id: null,
      quota_policy_id: 'catalog',
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const row = await db
    .selectFrom('workspace')
    .select('id')
    .where('type', '=', 'catalog')
    .executeTakeFirstOrThrow();
  return row.id;
}
