import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Principal } from '../../platform/http/principal.js';
import { primaryReleases } from '../catalog/index.js';
import { workspaceIdsOf } from '../identity/index.js';
import { normalize } from './indexer.js';

export type SearchScope = 'all' | 'catalog' | 'mine';
export type SearchKind =
  'recording' | 'release' | 'artist' | 'person' | 'label' | 'private_audio' | 'audio_log';

/**
 * Search (SRC-001..003, SRC-009, ADR-0006). The visibility/ownership scope is
 * part of the SQL WHERE clause — never only a post-filter — and private hits are
 * re-checked against the canonical `audio_source` row in the same query, so a
 * stale index entry for deleted or foreign audio cannot leak (T05).
 * Ranking: exact identity/title first, then full-text rank, then trigram
 * similarity. Popularity is not a ranking input.
 */
export async function search(
  ctx: AppContext,
  principal: Principal,
  q: {
    q: string;
    scope: SearchScope;
    types: SearchKind[] | null;
    limit: number;
    cursor?: string | undefined;
  },
) {
  const norm = normalize(q.q);
  const workspaces = q.scope === 'catalog' ? [] : await workspaceIdsOf(ctx.db, principal.userId);
  const scopeKey = {
    userId: principal.userId,
    query: `search:${q.scope}:${q.types?.join(',') ?? '*'}:${norm}`,
  };
  const offset = Number((ctx.cursors.decode(scopeKey, q.cursor) ?? [0])[0]);
  const wantPublic = q.scope !== 'mine';
  const wantMine = q.scope !== 'catalog' && workspaces.length > 0;
  if (norm.length === 0 || (!wantPublic && !wantMine)) return { items: [], next_cursor: null };

  const tsq = sql`websearch_to_tsquery('simple', ${norm})`;
  const rows = await ctx.db
    .selectFrom('search_document as d')
    .leftJoin('audio_source as s', 's.id', 'd.id')
    .select([
      'd.id',
      'd.doc_kind',
      'd.title',
      'd.subtitle',
      'd.visibility',
      sql<boolean>`(${norm} = ANY(d.exact_keys) OR lower(d.title) = ${norm})`.as('exact'),
      sql<boolean>`d.tsv @@ ${tsq}`.as('text_hit'),
      sql<number>`ts_rank(d.tsv, ${tsq})`.as('rank'),
      sql<number>`similarity(d.norm, ${norm})`.as('sim'),
    ])
    .where((eb) => {
      const scopes = [];
      if (wantPublic) scopes.push(eb('d.visibility', '=', 'public'));
      if (wantMine) {
        scopes.push(
          eb.and([
            eb('d.visibility', '=', 'private'),
            eb('d.owner_workspace_id', 'in', workspaces),
            // Canonical re-check: the source still exists, is ready, and is in the same workspace.
            eb('s.status', '=', 'ready'),
            eb('s.workspace_id', 'in', workspaces),
          ]),
        );
      }
      return eb.or(scopes);
    })
    .where((eb) =>
      eb.or([
        sql<boolean>`${norm} = ANY(d.exact_keys)`,
        sql<boolean>`d.tsv @@ ${tsq}`,
        sql<boolean>`d.norm % ${norm}`,
        sql<boolean>`d.norm LIKE ${`%${norm.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`,
      ]),
    )
    .$if(q.types !== null, (qb) => qb.where('d.doc_kind', 'in', q.types ?? []))
    .orderBy(sql`(${norm} = ANY(d.exact_keys) OR lower(d.title) = ${norm})`, 'desc')
    .orderBy(sql`d.tsv @@ ${tsq}`, 'desc')
    .orderBy(sql`ts_rank(d.tsv, ${tsq})`, 'desc')
    .orderBy(sql`similarity(d.norm, ${norm})`, 'desc')
    .orderBy('d.id')
    .offset(offset)
    .limit(q.limit + 1)
    .execute();
  const page = rows.slice(0, q.limit);
  const primary = await primaryReleases(
    ctx.db,
    page.filter((r) => r.doc_kind === 'recording').map((r) => r.id),
  );
  return {
    items: page.map((r) => ({
      kind: r.doc_kind,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      match: r.exact ? 'exact' : r.text_hit ? 'text' : 'fuzzy',
      scope: r.visibility === 'private' ? 'mine' : 'catalog',
      ...(r.doc_kind === 'recording' ? { primary_release_id: primary.get(r.id) ?? null } : {}),
    })),
    next_cursor: rows.length > q.limit ? ctx.cursors.encode(scopeKey, [offset + q.limit]) : null,
  };
}
