import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import type { AppContext } from '../../app/context.js';
import type { DbOrTx } from '../../platform/db/db.js';
import { newId, type IdKind } from '../../platform/ids.js';
import { emit } from '../../platform/jobs/outbox.js';
import { enqueue } from '../../platform/jobs/queue.js';
import { BUCKETS } from '../../platform/storage/blob-store.js';
import { audit } from '../../platform/audit.js';
import { createCatalogSource } from '../audio/index.js';
import { ensureCatalogWorkspace } from '../identity/index.js';
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
  claims: z
    .array(
      z.strictObject({
        subject: key,
        stage: z.enum([
          'composition',
          'lyrics',
          'vocals',
          'instruments',
          'mixing',
          'mastering',
          'artwork',
        ]),
        method: z.enum(['human', 'ai_assisted', 'ai_generated', 'unknown']),
        issuer: z.string().min(1).max(200),
        basis: basis.default('declared'),
        verification_state: verification.default('self_declared'),
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

/** Input shape (defaults applied on parse). */
export type CatalogManifest = z.input<typeof manifestSchema>;

/**
 * A master referenced by the manifest: bytes in memory (tests, small fixtures) or a
 * file on disk, which is hashed and uploaded as a stream so a delivery of 24-bit
 * masters never has to fit in memory.
 */
export type AudioInput = Buffer | { path: string };

export const MAX_MASTER_BYTES = 5 * 1024 ** 3;

async function sha256Of(input: AudioInput): Promise<{ sha256: string; bytes: number }> {
  if (Buffer.isBuffer(input)) {
    return { sha256: createHash('sha256').update(input).digest('hex'), bytes: input.length };
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(input.path)) hash.update(chunk as Buffer);
  return { sha256: hash.digest('hex'), bytes: (await stat(input.path)).size };
}

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
  readAudio: (ref: string) => Promise<AudioInput>,
): Promise<IngestResult> {
  const m = manifestSchema.parse(manifest);

  // Audio is uploaded before the transaction and its processing job is enqueued
  // inside it, so a crash can leave at most unreferenced objects, never a source
  // stuck in `processing` without a job (review #11).
  const planned = new Map<string, { sourceId: string; prefix: string; sha256: string }>();
  // One master at a time: hashed, then streamed to storage.
  for (const r of m.recordings) {
    if (!r.audio) continue;
    const input = await readAudio(r.audio);
    const { sha256, bytes } = await sha256Of(input);
    // Single-request uploads and server-side copies stop at 5 GiB (S3 limits).
    if (bytes > MAX_MASTER_BYTES) {
      throw new Error(`master ${r.audio} is ${bytes} bytes; the limit is ${MAX_MASTER_BYTES}`);
    }
    const sourceId = newId('audioSource');
    const prefix = `${sourceId}/${randomBytes(12).toString('hex')}`;
    planned.set(r.key, { sourceId, prefix, sha256 });
    const body = Buffer.isBuffer(input) ? input : createReadStream(input.path);
    await ctx.blobs.put(BUCKETS.catalogOriginals, `${prefix}/original`, body, {
      contentType: 'application/octet-stream',
      bytes,
    });
  }

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
      const plan = planned.get(r.key);
      if (plan) {
        const { sourceId, sha256, prefix } = plan;
        await createCatalogSource(tx, {
          sourceId,
          recordingId: recId,
          workspaceId,
          sha256,
          storagePrefix: prefix,
        });
        await tx
          .updateTable('recording')
          .set({ catalog_audio_source_id: sourceId })
          .where('id', '=', recId)
          .execute();
        sources[r.key] = sourceId;
        await enqueue(tx, {
          kind: 'catalog.process',
          payload: { audio_source_id: sourceId, sha256 },
          dedupeKey: `catalog.process:${sourceId}`,
        });
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
    for (const c of m.claims) {
      await tx
        .insertInto('provenance_claim')
        .values({
          id: newId('provenanceClaim'),
          subject_entity_id: need(c.subject),
          claim_type: 'creation_method',
          stage: c.stage,
          value: c.method,
          issuer: c.issuer,
          basis: c.basis,
          verification_state: c.verification_state,
          evidence_ref: null,
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
    return { ids, sources };
  });

  return { ids: result.ids, sources: result.sources };
}
