import { sql } from 'kysely';
import type { DbOrTx } from '../../platform/db/db.js';
import { entitySummaries } from '../catalog/index.js';

/**
 * Lowercased, accent-folded text used for full-text and trigram (fuzzy) matching.
 * Hangul is decomposed into jamo, so a syllable still being typed (뉴지 for 뉴진) and a
 * one-jamo typo still match.
 */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** For exact matches against stored titles and keys, which keep Hangul composed. */
export function exactKey(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
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
    /** Other names of the entity: matched like the title (CQ-SRC-1). */
    aliases?: string[];
  },
): Promise<void> {
  const aliases = d.aliases ?? [];
  const text = [d.title, d.subtitle ?? '', ...aliases, d.body].join(' ');
  const named = [d.title, d.subtitle ?? '', ...aliases].join(' ');
  const values = {
    doc_kind: d.kind,
    owner_workspace_id: d.owner,
    visibility: d.owner ? ('private' as const) : ('public' as const),
    title: d.title,
    subtitle: d.subtitle,
    body: d.body,
    exact_keys: [...d.keys, ...aliases].map(exactKey),
    tsv: sql<string>`to_tsvector('simple', ${normalize(text)})`,
    norm: normalize(named),
    initials: sql<string>`rabit_initials(${named})`,
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
  let aliases: string[] = [];
  if (e.entity_type === 'recording' || e.entity_type === 'release') {
    const credits = await db
      .selectFrom('credit as c')
      .innerJoin('music_entity as m', 'm.id', 'c.contributor_entity_id')
      .select(['m.display_name', 'm.aliases'])
      .where('c.subject_entity_id', '=', entityId)
      .execute();
    // The main artists' other names find their tracks and releases too.
    const artists =
      e.entity_type === 'recording'
        ? db
            .selectFrom('recording_artist as a')
            .innerJoin('music_entity as m', 'm.id', 'a.artist_id')
            .select('m.aliases')
            .where('a.recording_id', '=', entityId)
        : db
            .selectFrom('release_artist as a')
            .innerJoin('music_entity as m', 'm.id', 'a.artist_id')
            .select('m.aliases')
            .where('a.release_id', '=', entityId);
    const artistAliases = (await artists.execute()).flatMap((a) => a.aliases);
    body = [...credits.flatMap((c) => [c.display_name, ...c.aliases]), ...artistAliases].join(' ');
  } else {
    const m = await db
      .selectFrom('music_entity')
      .select('aliases')
      .where('id', '=', entityId)
      .executeTakeFirst();
    aliases = m?.aliases ?? [];
  }
  await upsert(db, {
    id: entityId,
    kind: e.entity_type,
    owner: null,
    title: e.name,
    subtitle: e.subtitle,
    body,
    keys,
    aliases,
  });
}
