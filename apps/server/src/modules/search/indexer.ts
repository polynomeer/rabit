import { sql } from 'kysely';
import type { DbOrTx } from '../../platform/db/db.js';
import { entitySummaries } from '../catalog/index.js';

/** Lowercased, accent-folded text used for trigram (fuzzy) matching. */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function upsert(
  db: DbOrTx,
  d: {
    id: string;
    kind: 'recording' | 'release' | 'artist' | 'person' | 'label' | 'private_audio' | 'audio_log';
    owner: string | null;
    title: string;
    subtitle: string | null;
    body: string;
    keys: string[];
  },
): Promise<void> {
  const text = [d.title, d.subtitle ?? '', d.body].join(' ');
  const values = {
    doc_kind: d.kind,
    owner_workspace_id: d.owner,
    visibility: d.owner ? ('private' as const) : ('public' as const),
    title: d.title,
    subtitle: d.subtitle,
    body: d.body,
    exact_keys: d.keys.map((k) => k.toLowerCase()),
    tsv: sql<string>`to_tsvector('simple', ${normalize(text)})`,
    norm: normalize(`${d.title} ${d.subtitle ?? ''}`),
    updated_at: new Date(),
  };
  await db
    .insertInto('search_document')
    .values({ id: d.id, ...values })
    .onConflict((oc) => oc.column('id').doUpdateSet(values))
    .execute();
}

export async function removeDocument(db: DbOrTx, id: string): Promise<void> {
  await db.deleteFrom('search_document').where('id', '=', id).execute();
}

/**
 * Indexes the caller's own audio. Deleted or not-ready sources are removed, so
 * the index never outlives the canonical source (T05/T16). Notes and tags are
 * searchable only by the owner (scope predicate on owner_workspace_id).
 */
export async function indexSource(db: DbOrTx, sourceId: string): Promise<void> {
  const s = await db
    .selectFrom('audio_source as s')
    .leftJoin('audio_log as l', 'l.audio_source_id', 's.id')
    .select([
      's.id',
      's.origin',
      's.status',
      's.title',
      's.workspace_id',
      'l.note',
      'l.tags',
      'l.title as log_title',
    ])
    .where('s.id', '=', sourceId)
    .executeTakeFirst();
  if (!s || s.origin === 'catalog' || s.status !== 'ready') {
    await removeDocument(db, sourceId);
    return;
  }
  await upsert(db, {
    id: s.id,
    kind: s.origin === 'audio_log' ? 'audio_log' : 'private_audio',
    owner: s.workspace_id,
    title: s.log_title ?? s.title ?? 'Untitled',
    subtitle: s.origin === 'audio_log' ? 'Audio Log' : 'Private audio',
    body: [s.note ?? '', ...(s.tags ?? [])].join(' '),
    keys: [],
  });
}

/** Indexes a public catalog entity with its credits (Credits search, SRC-001). */
export async function indexEntity(db: DbOrTx, entityId: string): Promise<void> {
  const e = (await entitySummaries(db, [entityId])).get(entityId);
  if (!e) {
    await removeDocument(db, entityId);
    return;
  }
  const keys: string[] = [];
  let body = '';
  if (e.entity_type === 'recording') {
    const r = await db
      .selectFrom('recording')
      .select('isrc')
      .where('id', '=', entityId)
      .executeTakeFirst();
    if (r?.isrc) keys.push(r.isrc);
  }
  if (e.entity_type === 'release') {
    const r = await db
      .selectFrom('release')
      .select('upc')
      .where('id', '=', entityId)
      .executeTakeFirst();
    if (r?.upc) keys.push(r.upc);
  }
  if (e.entity_type === 'recording' || e.entity_type === 'release') {
    const credits = await db
      .selectFrom('credit as c')
      .innerJoin('music_entity as m', 'm.id', 'c.contributor_entity_id')
      .select('m.display_name')
      .where('c.subject_entity_id', '=', entityId)
      .execute();
    body = credits.map((c) => c.display_name).join(' ');
  }
  await upsert(db, {
    id: entityId,
    kind: e.entity_type,
    owner: null,
    title: e.name,
    subtitle: e.subtitle,
    body,
    keys,
  });
}
