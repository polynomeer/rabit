import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { PopularityTier } from '../../platform/db/schema.js';
import type { Principal } from '../../platform/http/principal.js';
import { entitySummaries, recordingSources, type EntitySummary } from '../catalog/index.js';
import { playabilities } from '../playback/index.js';
import { popularityOf, POPULARITY_CEILING, type PopularityFilter } from './connections.js';
import type { DigDeps } from './service.js';

/**
 * Crate Digging, private part (DIG-009): a small random crate of albums from an
 * era (release years) and a popularity level, like flipping through a record
 * crate. Every album has at least one track the caller can play. An album's
 * popularity is that of its most popular track; unknown popularity passes.
 * Location and genre need data the catalog does not have; public crates need a
 * moderation policy (OQ-DIG-07). Nothing is stored: saving uses the library.
 */
const POOL = 2000;

export async function digCrate(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  q: {
    from?: number | undefined;
    to?: number | undefined;
    popularity: PopularityFilter;
    size: number;
  },
) {
  let query = ctx.db
    .selectFrom('release')
    .select(['id', 'title', 'release_type', 'release_date', 'label_id']);
  if (q.from !== undefined) query = query.where('release_date', '>=', `${String(q.from)}-01-01`);
  if (q.to !== undefined) query = query.where('release_date', '<=', `${String(q.to)}-12-31`);
  const releases = await query
    .orderBy(sql`random()`)
    .limit(POOL)
    .execute();

  const excluded = await deps.excludedEntities(
    ctx.db,
    releases.map((r) => r.id),
  );
  const pool = releases.filter((r) => !excluded.has(r.id));
  if (pool.length === 0) return { items: [] };

  const tracks = await ctx.db
    .selectFrom('release_track')
    .select(['release_id', 'recording_id'])
    .where(
      'release_id',
      'in',
      pool.map((r) => r.id),
    )
    .execute();
  const recordingIds = [...new Set(tracks.map((t) => t.recording_id))];
  const [pop, sources] = await Promise.all([
    popularityOf(ctx.db, recordingIds),
    recordingSources(ctx.db, recordingIds),
  ]);
  const playable = await playabilities(ctx.db, deps.catalogAccess, principal, [
    ...sources.values(),
  ]);
  const canPlay = (rec: string) => {
    const src = sources.get(rec);
    return src !== undefined && playable.get(src)?.playable === true;
  };

  const ceiling = POPULARITY_CEILING[q.popularity];
  const picked: { release: (typeof pool)[number]; playableTracks: number; tier: PopularityTier }[] =
    [];
  for (const r of pool) {
    const own = tracks.filter((t) => t.release_id === r.id).map((t) => t.recording_id);
    const playableTracks = own.filter(canPlay).length;
    if (playableTracks === 0) continue;
    const known = own.map((id) => pop.get(id)).filter((p) => p?.percentile != null);
    const top = known.sort((a, b) => (b?.percentile ?? 0) - (a?.percentile ?? 0))[0];
    if ((top?.percentile ?? 0) > ceiling) continue;
    picked.push({ release: r, playableTracks, tier: top?.tier ?? 'unknown' });
    if (picked.length === q.size) break;
  }

  const artistRows = picked.length
    ? await ctx.db
        .selectFrom('release_artist')
        .select(['release_id', 'artist_id'])
        .where(
          'release_id',
          'in',
          picked.map((p) => p.release.id),
        )
        .orderBy('ord')
        .execute()
    : [];
  const hidden = await deps.excludedEntities(
    ctx.db,
    artistRows.map((a) => a.artist_id),
  );
  const names = await entitySummaries(ctx.db, [
    ...artistRows.filter((a) => !hidden.has(a.artist_id)).map((a) => a.artist_id),
    ...picked.map((p) => p.release.label_id).filter((x): x is string => x !== null),
  ]);
  const artistsOf = (releaseId: string) =>
    artistRows
      .filter((a) => a.release_id === releaseId && !hidden.has(a.artist_id))
      .map((a) => names.get(a.artist_id))
      .filter((a): a is EntitySummary => a !== undefined);

  return {
    items: picked.map((p) => ({
      release: {
        release_id: p.release.id,
        title: p.release.title,
        release_type: p.release.release_type,
        release_date: p.release.release_date,
      },
      artists: artistsOf(p.release.id),
      label: p.release.label_id ? (names.get(p.release.label_id) ?? null) : null,
      playable_tracks: p.playableTracks,
      popularity_tier: p.tier,
    })),
  };
}
