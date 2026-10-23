import { resolve, sep } from 'node:path';
import type { Selectable } from 'kysely';
import type { AppContext } from '../../app/context.js';
import { audit } from '../../platform/audit.js';
import type { DbOrTx } from '../../platform/db/db.js';
import type { RightsGrantTable } from '../../platform/db/schema.js';
import { emit } from '../../platform/jobs/outbox.js';
import { ErnError, readErn, type ErnConversion, type ErnPurge } from './ddex.js';
import { ingestCatalog, manifestSchema } from './ingest.js';
import { createGrant, setGrantEnd } from './rights.js';

/**
 * Ingests one ERN 4.3 message (ADR-0030):
 * - a NewReleaseMessage for a release not in the catalog creates it with the files it
 *   names, which must lie inside `deliveryDir`;
 * - one for a release already delivered by the same licensor updates its titles and
 *   brings the licensor's grants in line with the message's deals: an added end is a
 *   takedown, a deal no longer sent ends at once, a new deal becomes a grant;
 * - a PurgeReleaseMessage ends all of the licensor's grants on the release.
 * Grants of other licensors or made by operators are never touched.
 */
export async function ingestErn(
  ctx: AppContext,
  xml: string,
  deliveryDir: string,
  now = new Date(),
) {
  const msg = readErn(xml, now);
  if (msg.kind === 'purge') return purgeRelease(ctx, msg.purge, now);
  const c = msg.conversion;
  if (c.icpn) {
    const known = await ctx.db
      .selectFrom('release')
      .select('id')
      .where('upc', '=', c.icpn)
      .executeTakeFirst();
    if (known) return updateRelease(ctx, known.id, c, now);
  }
  if (c.isrcs.length > 0) {
    const known = await ctx.db
      .selectFrom('recording')
      .select('isrc')
      .where('isrc', 'in', c.isrcs)
      .execute();
    if (known.length > 0) {
      throw new ErnError(
        `Recordings already in the catalog under another release: ${known.map((k) => k.isrc).join(', ')}`,
      );
    }
  }
  const root = resolve(deliveryDir);
  const manifest = manifestSchema.parse(c.manifest);
  const result = await ingestCatalog(ctx, manifest, (ref) => {
    const path = resolve(root, ref);
    // ernToManifest already refuses such URIs; the files are opened here, so check again.
    if (!path.startsWith(root + sep)) {
      return Promise.reject(new ErnError(`File outside the delivery: ${ref}`));
    }
    return Promise.resolve({ path });
  });
  return { action: 'created' as const, ...result, skippedDeals: c.skippedDeals };
}

type Grant = Selectable<RightsGrantTable>;

/** LIKE pattern for the grants a licensor's deliveries created (`ddex:<sender>:…`). */
const fromSender = (senderId: string) =>
  `${`ddex:${senderId}:`.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** The licensor's grants still in force or waiting to start on these recordings. */
async function licensorGrants(tx: DbOrTx, recordingIds: string[], senderId: string, now: Date) {
  if (recordingIds.length === 0) return [];
  return tx
    .selectFrom('rights_grant')
    .selectAll()
    .where('recording_id', 'in', recordingIds)
    .where('contract_ref', 'like', fromSender(senderId))
    .where('status', 'in', ['active', 'suspended'])
    .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', now)]))
    .forUpdate()
    .execute();
}

/** The release's tracks with their ISRCs, in order. */
async function tracksOf(tx: DbOrTx, releaseId: string) {
  return tx
    .selectFrom('release_track as t')
    .innerJoin('recording as r', 'r.id', 't.recording_id')
    .select(['r.id', 'r.isrc', 'r.title'])
    .where('t.release_id', '=', releaseId)
    .orderBy('t.disc_no')
    .orderBy('t.position')
    .execute();
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

async function updateRelease(ctx: AppContext, releaseId: string, c: ErnConversion, now: Date) {
  const m = manifestSchema.parse(c.manifest);
  const release = m.releases[0];
  if (!release) throw new ErnError('The message has no release.');
  const isrcByKey = new Map(m.recordings.map((r) => [r.key, r.isrc]));
  const reason = `ddex update ${c.messageId}`;
  return ctx.db.transaction().execute(async (tx) => {
    const tracks = await tracksOf(tx, releaseId);
    const wanted = release.tracks.map((k) => isrcByKey.get(k));
    if (wanted.some((i) => i === undefined)) {
      throw new ErnError('An update must identify every track by its ISRC.');
    }
    // Changing the track list needs new audio and an operator's look; not automatic.
    if (
      !sameSet(
        tracks.map((t) => t.isrc ?? ''),
        wanted.map((i) => i ?? ''),
      )
    ) {
      throw new ErnError('The update changes the track list; an operator must apply it.');
    }
    const byIsrc = new Map(tracks.map((t) => [t.isrc ?? '', t]));
    const recordingIds = tracks.map((t) => t.id);
    const existing = await licensorGrants(tx, recordingIds, c.senderId, now);
    const ever = await tx
      .selectFrom('rights_grant')
      .select('id')
      .where('recording_id', 'in', recordingIds)
      .where('contract_ref', 'like', fromSender(c.senderId))
      .executeTakeFirst();
    if (!ever) {
      throw new ErnError(
        `Release ${c.icpn ?? ''} was not delivered by ${c.senderId}; an operator must resolve it.`,
      );
    }

    // Titles: the release and each recording, by ISRC.
    const changed = new Set<string>();
    const current = await tx
      .selectFrom('release')
      .select(['title', 'release_date'])
      .where('id', '=', releaseId)
      .executeTakeFirstOrThrow();
    if (
      current.title !== release.title ||
      (release.date && current.release_date !== release.date)
    ) {
      await tx
        .updateTable('release')
        .set({ title: release.title, ...(release.date ? { release_date: release.date } : {}) })
        .where('id', '=', releaseId)
        .execute();
      await tx
        .updateTable('music_entity')
        .set({ display_name: release.title })
        .where('id', '=', releaseId)
        .execute();
      changed.add(releaseId);
    }
    for (const r of m.recordings) {
      const track = r.isrc ? byIsrc.get(r.isrc) : undefined;
      if (!track || track.title === r.title) continue;
      await tx
        .updateTable('recording')
        .set({ title: r.title })
        .where('id', '=', track.id)
        .execute();
      await tx
        .updateTable('music_entity')
        .set({ display_name: r.title })
        .where('id', '=', track.id)
        .execute();
      changed.add(track.id);
    }

    // Grants: match the licensor's grants to the message's deals by uses, territories
    // and start; the end follows the message. Unmatched grants end now.
    let created = 0;
    let ended = 0;
    let moved = 0;
    const unmatched = new Map<string, Grant>(existing.map((g) => [g.id, g]));
    for (const d of m.grants) {
      const isrc = isrcByKey.get(d.recording);
      const track = isrc ? byIsrc.get(isrc) : undefined;
      if (!track) continue;
      const from = new Date(d.valid_from ?? 0).getTime();
      const end = d.valid_to ? new Date(d.valid_to) : null;
      const match = [...unmatched.values()].find(
        (g) =>
          g.recording_id === track.id &&
          sameSet(g.uses, d.uses) &&
          sameSet(g.territories, d.territories) &&
          g.valid_from.getTime() === from,
      );
      if (match) {
        unmatched.delete(match.id);
        if ((match.valid_to?.getTime() ?? null) !== (end?.getTime() ?? null)) {
          const g = await setGrantEnd(tx, match, end, reason, now);
          if (g.status === 'expired' || g.status === 'revoked') ended += 1;
          else moved += 1;
        }
        continue;
      }
      await createGrant(
        tx,
        { type: 'system', id: null },
        {
          recording_id: track.id,
          rights_holder: d.rights_holder,
          territories: d.territories,
          uses: d.uses,
          valid_from: d.valid_from ?? new Date(0).toISOString(),
          valid_to: d.valid_to,
          contract_ref: d.contract_ref,
        },
        reason,
        null,
      );
      created += 1;
    }
    // A deal the licensor no longer sends is no longer licensed: end it now.
    for (const g of unmatched.values()) {
      await setGrantEnd(tx, g, now, `${reason}: deal no longer sent`, now);
      ended += 1;
    }

    for (const id of changed) {
      await emit(tx, {
        type: 'CatalogEntityChanged',
        schemaVersion: 1,
        subjectId: id,
        privacyScope: 'catalog',
        payload: { entity_id: id },
      });
    }
    await audit(tx, {
      actorType: 'system',
      actorId: null,
      action: 'catalog.updated_by_delivery',
      subjectType: 'release',
      subjectId: releaseId,
      reason,
      details: { sender: c.senderId, created, ended, moved, renamed: changed.size },
    });
    return {
      action: 'updated' as const,
      release_id: releaseId,
      grants: { created, ended, moved },
      renamed: changed.size,
      skippedDeals: c.skippedDeals,
    };
  });
}

/**
 * PurgeReleaseMessage: the licensor's grants on the release end now, so it stops
 * playing everywhere they licensed it. Removing the release's audio and metadata
 * stays an operator action (catalog audio removal), as other grants may remain.
 */
async function purgeRelease(ctx: AppContext, p: ErnPurge, now: Date) {
  const reason = `ddex purge ${p.messageId}`;
  return ctx.db.transaction().execute(async (tx) => {
    const release = await tx
      .selectFrom('release')
      .select('id')
      .where('upc', '=', p.icpn)
      .executeTakeFirst();
    if (!release) throw new ErnError(`Release ${p.icpn} is not in the catalog.`);
    const tracks = await tracksOf(tx, release.id);
    const grants = await licensorGrants(
      tx,
      tracks.map((t) => t.id),
      p.senderId,
      now,
    );
    for (const g of grants) await setGrantEnd(tx, g, now, reason, now);
    await audit(tx, {
      actorType: 'system',
      actorId: null,
      action: 'catalog.purged_by_delivery',
      subjectType: 'release',
      subjectId: release.id,
      reason,
      details: { sender: p.senderId, ended: grants.length },
    });
    return {
      action: 'purged' as const,
      release_id: release.id,
      grants: { created: 0, ended: grants.length, moved: 0 },
    };
  });
}
