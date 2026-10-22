import { sql } from 'kysely';
import type { AppContext } from '../../app/context.js';
import type { Basis } from '../../platform/db/schema.js';
import type { Principal } from '../../platform/http/principal.js';
import { entitySummaries, recordingSources } from '../catalog/index.js';
import { playabilities } from '../playback/index.js';
import { connectionsFor, type Connection, type DigAxis } from './connections.js';
import type { DigDeps } from './service.js';

/**
 * Track-based autoplay suggestions (ADR-0026): catalog recordings the listener can
 * play now, from the seed's DIG connections, closest first, each with its reason
 * (DSC-006). Nothing is ranked by listening counts (DSC-005); ML-inferred links are
 * used only when the listener includes them (as in DIG).
 */
export type RadioReasonCode =
  | 'samples'
  | 'sampled_by'
  | 'covers'
  | 'covered_by'
  | 'remixes'
  | 'remix_of'
  | 'same_producer'
  | 'influences'
  | 'influenced_by'
  | 'same_artist'
  | 'member_project'
  | 'same_label'
  | 'same_decade';

export interface RadioReason {
  code: RadioReasonCode;
  /** The person, artist or label it goes through; the decade for same_decade. */
  name: string | null;
  basis: Basis;
}

export interface RadioPick {
  recording_id: string;
  reason: RadioReason;
}

/** At most this many suggestions per main artist in one batch (diversity). */
const PER_ARTIST = 2;

/** Deterministic shuffle: the same seed and nonce give the same order. */
function shuffle<T>(list: T[], seed: string): T[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return h / 0x1_0000_0000;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export async function radioFor(
  ctx: AppContext,
  deps: DigDeps,
  principal: Principal,
  seed: string,
  opts: { exclude: ReadonlySet<string>; size: number; includeInferred: boolean; nonce?: string },
): Promise<RadioPick[]> {
  const db = ctx.db;
  const isRecording = await db
    .selectFrom('recording')
    .select('id')
    .where('id', '=', seed)
    .executeTakeFirst();
  if (!isRecording) return [];
  const nonce = `${seed}:${opts.nonce ?? ''}`;
  const tiers: { picks: RadioPick[] }[] = [];

  const fromAxes = async (axes: DigAxis[], code: (a: DigAxis) => RadioReasonCode) => {
    const picks: RadioPick[] = [];
    for (const axis of axes) {
      for (const c of await connectionsFor(db, seed, axis)) {
        if (c.evidence.basis === 'ml_inferred' && !opts.includeInferred) continue;
        picks.push({ recording_id: c.entityId, reason: await reasonOf(c, code(axis)) });
      }
    }
    return picks;
  };
  const via = new Map<string, string>();
  const reasonOf = async (c: Connection, code: RadioReasonCode): Promise<RadioReason> => {
    let name: string | null = null;
    if (c.viaEntityId) {
      name = via.get(c.viaEntityId) ?? null;
      if (name === null) {
        name = (await entitySummaries(db, [c.viaEntityId])).get(c.viaEntityId)?.name ?? null;
        if (name) via.set(c.viaEntityId, name);
      }
    }
    return { code, name, basis: c.evidence.basis };
  };

  // 1. Samples, covers and remixes, both ways. 2. Credited people. 3. Influences.
  tiers.push({
    picks: await fromAxes(
      ['samples', 'sampled_by', 'covers', 'covered_by', 'remixes', 'remix_of'],
      (a) => a as RadioReasonCode,
    ),
  });
  tiers.push({ picks: await fromAxes(['same_producer'], () => 'same_producer') });
  tiers.push({
    picks: await fromAxes(['influences', 'influenced_by'], (a) => a as RadioReasonCode),
  });

  // 4. The same artist, 5. other projects of its members.
  const artists = (await connectionsFor(db, seed, 'artists')).map((c) => c.entityId);
  const names = await entitySummaries(db, artists);
  const sameArtist: RadioPick[] = [];
  const memberProjects: RadioPick[] = [];
  for (const artist of artists) {
    for (const t of await connectionsFor(db, artist, 'tracks'))
      sameArtist.push({
        recording_id: t.entityId,
        reason: { code: 'same_artist', name: names.get(artist)?.name ?? null, basis: 'declared' },
      });
    for (const m of await connectionsFor(db, artist, 'members')) {
      for (const other of await connectionsFor(db, m.entityId, 'member_of')) {
        if (other.entityId === artist) continue;
        const otherName = (await entitySummaries(db, [other.entityId])).get(other.entityId)?.name;
        for (const t of await connectionsFor(db, other.entityId, 'tracks'))
          memberProjects.push({
            recording_id: t.entityId,
            reason: { code: 'member_project', name: otherName ?? null, basis: m.evidence.basis },
          });
      }
    }
  }
  tiers.push({ picks: sameArtist }, { picks: memberProjects });

  // 6. The same label, 7. the same decade.
  tiers.push({ picks: await fromAxes(['same_label'], () => 'same_label') });
  const decade = await sql<{ d: number | null }>`
    SELECT (floor(extract(year FROM min(r.release_date)) / 10) * 10)::int AS d
    FROM release_track t JOIN release r ON r.id = t.release_id
    WHERE t.recording_id = ${seed} AND r.release_date IS NOT NULL`.execute(db);
  const d = decade.rows[0]?.d ?? null;
  if (d !== null) {
    const rows = await sql<{ recording_id: string }>`
      SELECT DISTINCT t.recording_id FROM release_track t JOIN release r ON r.id = t.release_id
      WHERE r.release_date >= ${`${String(d)}-01-01`} AND r.release_date <= ${`${String(d + 9)}-12-31`}
      LIMIT 300`.execute(db);
    tiers.push({
      picks: rows.rows.map((r) => ({
        recording_id: r.recording_id,
        reason: { code: 'same_decade', name: String(d), basis: 'declared' },
      })),
    });
  }

  // Candidates in tier order, each tier shuffled so a refresh can differ (nonce).
  const seen = new Set<string>([seed, ...opts.exclude]);
  const ordered: RadioPick[] = [];
  for (const [i, tier] of tiers.entries()) {
    for (const p of shuffle(tier.picks, `${nonce}:${String(i)}`)) {
      if (seen.has(p.recording_id)) continue;
      seen.add(p.recording_id);
      ordered.push(p);
    }
  }
  if (ordered.length === 0) return [];

  // Only what the listener can play now, never what integrity review excluded.
  const ids = ordered.map((p) => p.recording_id);
  const [sources, excluded, mainArtists] = await Promise.all([
    recordingSources(db, ids),
    deps.excludedEntities(db, ids),
    db
      .selectFrom('recording_artist')
      .select(['recording_id', 'artist_id'])
      .where('recording_id', 'in', ids)
      .where('ord', '=', 0)
      .execute(),
  ]);
  const playable = await playabilities(db, deps.catalogAccess, principal, [...sources.values()]);
  const artistOf = new Map(mainArtists.map((a) => [a.recording_id, a.artist_id]));
  const perArtist = new Map<string, number>();
  const out: RadioPick[] = [];
  for (const p of ordered) {
    if (out.length === opts.size) break;
    if (excluded.has(p.recording_id)) continue;
    const src = sources.get(p.recording_id);
    if (!src || playable.get(src)?.playable !== true) continue;
    const a = artistOf.get(p.recording_id);
    if (a) {
      const n = perArtist.get(a) ?? 0;
      if (n >= PER_ARTIST) continue;
      perArtist.set(a, n + 1);
    }
    out.push(p);
  }
  // Samples, covers, remixes and influences point at the track itself: name its artists.
  const unnamed = out.filter((p) => p.reason.name === null).map((p) => p.recording_id);
  if (unnamed.length > 0) {
    const s = await entitySummaries(db, unnamed);
    for (const p of out)
      if (p.reason.name === null) p.reason.name = s.get(p.recording_id)?.subtitle ?? null;
  }
  return out;
}
