import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog } from './helpers/catalog.js';
import { createHarness, type Harness } from './helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function sourceOf(recordingId: string) {
  return h.ctx.db
    .selectFrom('audio_version as v')
    .innerJoin('audio_source as s', 's.audio_version_id', 'v.id')
    .select(['s.status', 's.failure_code', 'v.technical'])
    .where('v.recording_id', '=', recordingId)
    .executeTakeFirstOrThrow();
}

describe('catalog master QC (audio-pipeline §2)', () => {
  it('records codec family, bit depth, rendition rate and gapless metadata', async () => {
    const cat = await seedCatalog(h);
    const wav = await sourceOf(cat.ids['r1']!);
    expect(wav.status).toBe('ready');
    expect(wav.technical).toMatchObject({
      lossless: true,
      bits_per_sample: 16,
      rendition_sample_rate: 44_100,
      gapless: true,
    });
    const mp3 = await sourceOf(cat.ids['r3']!);
    expect(mp3).toMatchObject({ status: 'ready', technical: { lossless: false } });
  });

  it('refuses lossy masters when the delivery spec requires lossless', async () => {
    h.ctx.config.catalog.requireLossless = true;
    try {
      const cat = await seedCatalog(h);
      expect(await sourceOf(cat.ids['r3']!)).toMatchObject({
        status: 'failed',
        failure_code: 'MASTER_NOT_LOSSLESS',
      });
      expect((await sourceOf(cat.ids['r1']!)).status).toBe('ready');
    } finally {
      h.ctx.config.catalog.requireLossless = false;
    }
  });
});
