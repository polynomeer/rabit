import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { newId, type IdKind } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { enqueue } from '../../platform/jobs/queue.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import { audit } from '../../platform/audit.js';
import { ensureCatalogWorkspace } from './entities.js';
import { createGrant } from './rights.js';

const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const basis = z.enum(['verified_fact', 'declared', 'ml_inferred']);
const verification = z.enum([
  'self_declared',
  'distributor_verified',
  'signature_valid',
  'process_evidence_reviewed',
  'rights_reviewed',
]);

/**
 * Catalog ingest manifest. Entities are referenced by manifest-local keys.
 * Production ingest from a supplier needs stable supplier IDs (Q02, OQ-DIG-06);
 * this format is for licensed fixtures and self-made test content (CAT-008).
 */
export const manifestSchema = z.strictObject({
  source: z.string().min(1).max(100),
  artists: z.array(z.strictObject({ key, name: z.string().min(1).max(300) })).default([]),
  people: z.array(z.strictObject({ key, name: z.string().min(1).max(300) })).default([]),
  labels: z.array(z.strictObject({ key, name: z.string().min(1).max(300) })).default([]),
  recordings: z.array(
    z.strictObject({
      key,
      title: z.string().min(1).max(300),
      isrc: z
        .string()
        .regex(/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/)
        .optional(),
      artists: z.array(key).min(1),
      audio: z.string().min(1).optional(),
    }),
  ),
  releases: z
    .array(
      z.strictObject({
        key,
        title: z.string().min(1).max(300),
        type: z.enum(['album', 'single', 'ep', 'compilation']),
        label: key.optional(),
        date: z.iso.date().optional(),
        upc: z
          .string()
          .regex(/^\d{12,14}$/)
          .optional(),
        artists: z.array(key).min(1),
        tracks: z.array(key).min(1),
      }),
    )
    .default([]),
  credits: z
    .array(
      z.strictObject({
        subject: key,
        contributor: key,
        role: z.enum([
          'composer',
          'lyricist',
          'producer',
          'engineer',
          'mixing_engineer',
          'mastering_engineer',
          'performer',
          'featured_artist',
          'arranger',
        ]),
        instrument: z.string().max(60).optional(),
        creation_method: z
          .enum(['human', 'ai_assisted', 'ai_generated', 'unknown'])
          .default('unknown'),
        basis: basis.default('declared'),
        verification_state: verification.default('self_declared'),
      }),
    )
    .default([]),
  relations: z
    .array(
      z.strictObject({
        from: key,
        to: key,
        type: z.enum(['samples', 'covers', 'remix_of', 'influenced_by', 'member_of', 'signed_to']),
        basis,
        confidence: z.number().gt(0).max(1).optional(),
        verification_state: verification,
        license_status: z.enum(['unknown', 'licensed', 'not_applicable']).default('unknown'),
        evidence_ref: z.string().max(300).optional(),
      }),
    )
    .default([]),
  grants: z
    .array(
      z.strictObject({
        recording: key,
        rights_holder: z.string().min(1).max(200),
        territories: z.array(z.string().regex(/^([A-Z]{2}|WORLD)$/)).min(1),
        uses: z
          .array(z.enum(['stream', 'download', 'preview', 'transform', 'stem', 'analysis']))
          .min(1),
        contract_ref: z.string().min(1).max(200),
        valid_to: z.iso.datetime().optional(),
      }),
    )
    .default([]),
});

export type CatalogManifest = z.infer<typeof manifestSchema>;

export interface IngestResult {
  ids: Record<string, string>;
  sources: Record<string, string>;
}

function sortName(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

async function insertEntity(
  db: DbOrTx,
  kind: Extract<IdKind, 'artist' | 'person' | 'label' | 'release' | 'recording'>,
  name: string,
): Promise<string> {
  const id = newId(kind);
  await db
    .insertInto('music_entity')
    .values({ id, entity_type: kind, display_name: name, sort_name: sortName(name) })
    .execute();
  return id;
}

/**
 * Ingests a manifest in one transaction, uploads catalog audio to the catalog
 * originals namespace and queues processing. Catalog sources live in the system
 * catalog workspace and are `public` (metadata) — playback still requires a grant
 * and an entitlement at access time.
 */
export async function ingestCatalog(
  ctx: AppContext,
  manifest: CatalogManifest,
  readAudio: (ref: string) => Promise<Buffer>,
): Promise<IngestResult> {
  const m = manifestSchema.parse(manifest);
  const audio = new Map<string, Buffer>();
  for (const r of m.recordings) if (r.audio) audio.set(r.key, await readAudio(r.audio));

  const result = await ctx.db.transaction().execute(async (tx) => {
    const ids: Record<string, string> = {};
    const need = (k: string) => {
      const id = ids[k];
      if (!id) throw new Error(`manifest references unknown key: ${k}`);
      return id;
    };
    for (const a of m.artists) ids[a.key] = await insertEntity(tx, 'artist', a.name);
    for (const p of m.people) ids[p.key] = await insertEntity(tx, 'person', p.name);
    for (const l of m.labels) ids[l.key] = await insertEntity(tx, 'label', l.name);

    const workspaceId = await ensureCatalogWorkspace(tx, () => newId('workspace'));
    const sources: Record<string, string> = {};
    const pending: {
      key: string;
      sourceId: string;
      prefix: string;
      sha256: string;
      bytes: Buffer;
    }[] = [];
    for (const r of m.recordings) {
      const recId = await insertEntity(tx, 'recording', r.title);
      ids[r.key] = recId;
      await tx
        .insertInto('recording')
        .values({
          id: recId,
          title: r.title,
          isrc: r.isrc ?? null,
          duration_ms: null,
          catalog_audio_source_id: null,
        })
        .execute();
      for (const [ord, a] of r.artists.entries()) {
        await tx
          .insertInto('recording_artist')
          .values({ recording_id: recId, artist_id: need(a), ord })
          .execute();
      }
      const bytes = audio.get(r.key);
      if (bytes) {
        const objectId = newId('audioObject');
        const versionId = newId('audioVersion');
        const sourceId = newId('audioSource');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const prefix = `${sourceId}/${randomBytes(12).toString('hex')}`;
        await tx
          .insertInto('audio_object')
          .values({ id: objectId, kind: 'recording', current_version_id: versionId })
          .execute();
        await tx
          .insertInto('audio_version')
          .values({
            id: versionId,
            audio_object_id: objectId,
            version_no: 1,
            recording_id: recId,
            content_sha256: sha256,
            duration_ms: null,
            technical: JSON.stringify({}),
          })
          .execute();
        await tx
          .insertInto('audio_source')
          .values({
            id: sourceId,
            audio_version_id: versionId,
            workspace_id: workspaceId,
            origin: 'catalog',
            visibility: 'public',
            status: 'processing',
            title: null,
            created_by: null,
            failure_code: null,
            storage_prefix: prefix,
            deleted_at: null,
          })
          .execute();
        await tx
          .updateTable('recording')
          .set({ catalog_audio_source_id: sourceId })
          .where('id', '=', recId)
          .execute();
        sources[r.key] = sourceId;
        pending.push({ key: r.key, sourceId, prefix, sha256, bytes });
      }
    }
    for (const rel of m.releases) {
      const relId = await insertEntity(tx, 'release', rel.title);
      ids[rel.key] = relId;
      await tx
        .insertInto('release')
        .values({
          id: relId,
          title: rel.title,
          release_type: rel.type,
          label_id: rel.label ? need(rel.label) : null,
          release_date: rel.date ?? null,
          upc: rel.upc ?? null,
        })
        .execute();
      for (const [ord, a] of rel.artists.entries()) {
        await tx
          .insertInto('release_artist')
          .values({ release_id: relId, artist_id: need(a), ord })
          .execute();
      }
      for (const [i, t] of rel.tracks.entries()) {
        await tx
          .insertInto('release_track')
          .values({ release_id: relId, disc_no: 1, position: i + 1, recording_id: need(t) })
          .execute();
      }
    }
    for (const c of m.credits) {
      await tx
        .insertInto('credit')
        .values({
          id: newId('credit'),
          subject_entity_id: need(c.subject),
          contributor_entity_id: need(c.contributor),
          role: c.role,
          instrument: c.instrument ?? null,
          creation_method: c.creation_method,
          basis: c.basis,
          verification_state: c.verification_state,
          source: m.source,
          evidence_ref: null,
        })
        .execute();
    }
    for (const r of m.relations) {
      await tx
        .insertInto('music_relation')
        .values({
          id: newId('relation'),
          from_entity_id: need(r.from),
          to_entity_id: need(r.to),
          relation_type: r.type,
          basis: r.basis,
          confidence: r.confidence ?? null,
          verification_state: r.verification_state,
          source: m.source,
          evidence_ref: r.evidence_ref ?? null,
          license_status: r.license_status,
          valid_from: null,
          valid_to: null,
        })
        .execute();
    }
    for (const g of m.grants) {
      await createGrant(
        tx,
        { type: 'system', id: null },
        {
          recording_id: need(g.recording),
          rights_holder: g.rights_holder,
          territories: g.territories,
          uses: g.uses,
          valid_from: new Date(0).toISOString(),
          valid_to: g.valid_to,
          contract_ref: g.contract_ref,
        },
        `catalog ingest: ${m.source}`,
        null,
      );
    }
    for (const id of Object.values(ids)) {
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
      action: 'catalog.ingested',
      subjectType: 'catalog_manifest',
      subjectId: m.source,
      details: { entities: Object.keys(ids).length },
    });
    return { ids, sources, pending };
  });

  // Upload audio after commit, then queue processing (idempotent dedupe per source).
  for (const p of result.pending) {
    await ctx.blobs.put(BUCKETS.catalogOriginals, `${p.prefix}/original`, p.bytes, {
      contentType: 'application/octet-stream',
      bytes: p.bytes.length,
    });
    await enqueue(ctx.db, {
      kind: 'catalog.process',
      payload: { audio_source_id: p.sourceId, sha256: p.sha256 },
      dedupeKey: `catalog.process:${p.sourceId}`,
    });
  }
  return { ids: result.ids, sources: result.sources };
}
