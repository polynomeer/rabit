import { ingestCatalog, type CatalogManifest } from '../../src/modules/catalog/index.js';
import { ulid } from '../../src/platform/ids.js';
import { fixtures } from './audio-fixtures.js';
import type { Harness, TestUser } from './harness.js';

/**
 * A small fictional catalog with self-generated audio (CAT-008). Keys are fixed;
 * the returned ids map keys to generated ids. Grants cover KR only.
 */
export async function seedCatalog(h: Harness, opts: { grant?: boolean } = {}) {
  const tag = ulid().slice(-6).toLowerCase();
  const manifest: CatalogManifest = {
    source: `test-fixture-${tag}`,
    artists: [
      { key: 'band', name: `The Test Tones ${tag}` },
      { key: 'solo', name: `Solo Sine ${tag}` },
    ],
    people: [
      { key: 'producer', name: `Pat Producer ${tag}` },
      { key: 'bassist', name: `Bea Bassist ${tag}` },
    ],
    labels: [{ key: 'label', name: `Fixture Records ${tag}` }],
    recordings: [
      { key: 'r1', title: `First Tone ${tag}`, artists: ['band'], audio: 'wav' },
      { key: 'r2', title: `Second Tone ${tag}`, artists: ['band'], audio: 'flac' },
      { key: 'r3', title: `Solo Piece ${tag}`, artists: ['solo'], audio: 'mp3' },
      { key: 'r4', title: `Silent Demo ${tag}`, artists: ['solo'] },
    ],
    releases: [
      {
        key: 'album',
        title: `Test Album ${tag}`,
        type: 'album',
        label: 'label',
        date: '2025-05-01',
        artists: ['band'],
        tracks: ['r1', 'r2'],
      },
      {
        key: 'single',
        title: `Solo Single ${tag}`,
        type: 'single',
        label: 'label',
        artists: ['solo'],
        tracks: ['r3', 'r4'],
      },
    ],
    credits: [
      {
        subject: 'r1',
        contributor: 'producer',
        role: 'producer',
        creation_method: 'human',
        basis: 'verified_fact',
        verification_state: 'distributor_verified',
      },
      {
        subject: 'r3',
        contributor: 'producer',
        role: 'producer',
        creation_method: 'human',
        basis: 'declared',
        verification_state: 'self_declared',
      },
      {
        subject: 'r1',
        contributor: 'bassist',
        role: 'performer',
        instrument: 'bass',
        creation_method: 'human',
        basis: 'declared',
        verification_state: 'self_declared',
      },
      {
        subject: 'r2',
        contributor: 'bassist',
        role: 'performer',
        instrument: 'bass',
        creation_method: 'human',
        basis: 'declared',
        verification_state: 'self_declared',
      },
    ],
    relations: [
      {
        from: 'r3',
        to: 'r1',
        type: 'samples',
        basis: 'verified_fact',
        verification_state: 'rights_reviewed',
        license_status: 'licensed',
      },
      {
        from: 'r2',
        to: 'r3',
        type: 'influenced_by',
        basis: 'ml_inferred',
        confidence: 0.62,
        verification_state: 'self_declared',
      },
    ],
    claims: [
      {
        subject: 'r1',
        stage: 'composition',
        method: 'human',
        issuer: 'Fixture Records',
        basis: 'declared',
        verification_state: 'distributor_verified',
      },
      { subject: 'r1', stage: 'mastering', method: 'ai_assisted', issuer: 'Fixture Records' },
    ],
    grants:
      opts.grant === false
        ? []
        : ['r1', 'r2', 'r3'].map((r) => ({
            recording: r,
            rights_holder: 'Fixture Rights Ltd',
            territories: ['KR'],
            uses: ['stream' as const],
            contract_ref: `FIXTURE-${tag}`,
          })),
  };
  const audio: Record<string, () => Buffer> = {
    wav: fixtures.wav,
    flac: fixtures.flac,
    mp3: fixtures.mp3,
  };
  const result = await ingestCatalog(h.ctx, manifest, (ref) => Promise.resolve(audio[ref]!()));
  await h.worker.drain();
  return result;
}

/** Operator helpers (operator role + MFA). */
export async function asOperator(h: Harness) {
  const op = await h.user({ operator: true });
  return {
    op,
    async setCountry(u: TestUser, country: string) {
      const r = await h.api.inject({
        method: 'PUT',
        url: `/v1/ops/users/${u.userId}/license-country`,
        headers: op.headers,
        payload: { license_country: country, reason: 'test setup' },
      });
      if (r.statusCode !== 200) throw new Error(r.body);
    },
    async subscribe(
      u: TestUser,
      state: 'active' | 'past_due' | 'cancelled' | 'expired' = 'active',
    ) {
      const r = await h.api.inject({
        method: 'PUT',
        url: `/v1/ops/users/${u.userId}/subscription`,
        headers: op.headers,
        payload: {
          state,
          paid_through: new Date(Date.now() + 30 * 86400_000).toISOString(),
          reason: 'test setup',
        },
      });
      if (r.statusCode !== 200) throw new Error(r.body);
      await h.worker.drain();
    },
  };
}
