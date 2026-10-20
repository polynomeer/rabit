import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AAC_PRIMING_SAMPLES, readEditList } from '../src/modules/audio/media/gapless.js';
import { probe } from '../src/modules/audio/media/inspect.js';
import { outputSampleRate, transcodeHls } from '../src/modules/audio/media/render.js';
import { fixtures } from './helpers/audio-fixtures.js';

/** Source material and renditions for ADR-0008 (gapless, sample rate) and QC fields. */
const dir = mkdtempSync(join(tmpdir(), 'rabit-render-'));

function tone(name: string, rate: number, samples: number, codec = 'pcm_s16le'): string {
  const out = join(dir, name);
  execFileSync('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi'],
    ...['-i', `sine=frequency=440:sample_rate=${rate}`],
    ...['-ac', '2', '-af', `atrim=end_sample=${samples}`, '-c:a', codec, out],
  ]);
  return out;
}

/** Decodes to mono 16-bit PCM at `rate`; HLS playlists are read from local files only. */
function pcm(input: string, rate: number): Int16Array {
  const buf = execFileSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', input],
      ...['-ac', '1', '-ar', String(rate), '-f', 's16le', '-'],
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

async function render(input: string) {
  const probed = await probe('ffprobe', input, { maxDurationMs: 60_000 });
  if (!probed.ok) throw new Error(probed.reason);
  const work = mkdtempSync(join(dir, 'work-'));
  const hls = await transcodeHls('ffmpeg', input, work, {
    durationMs: probed.result.durationMs,
    sampleRate: probed.result.sampleRate,
    samples: probed.result.samples,
  });
  if (!hls.ok) throw new Error(hls.stderr);
  return { info: probed.result, out: hls.output };
}

describe('rendition sample rate (ADR-0008 amendment 2026-10-20)', () => {
  it('keeps the 44.1 kHz family at 44.1 kHz and moves the rest to 48 kHz', () => {
    expect([11_025, 22_050, 44_100, 88_200, 176_400].map(outputSampleRate)).toEqual([
      44_100, 44_100, 44_100, 44_100, 44_100,
    ]);
    expect([8_000, 32_000, 48_000, 96_000, 192_000].map(outputSampleRate)).toEqual([
      48_000, 48_000, 48_000, 48_000, 48_000,
    ]);
  });

  it('renders a 96 kHz master at 48 kHz', async () => {
    const { out } = await render(tone('hires.flac', 96_000, 96_000, 'flac'));
    expect(out.sampleRate).toBe(48_000);
    expect(await readEditList(join(out.dir, 'standard', 'init.mp4'))).toMatchObject({
      movieTimescale: 48_000,
      segmentDuration: 48_000,
    });
  });
});

describe('rendition ladder (ADR-0008 amendment 2026-10-20)', () => {
  it('writes three renditions behind a master playlist, standard first', async () => {
    const { out } = await render(tone('ladder.wav', 44_100, 441_000));
    for (const r of ['low', 'standard', 'high']) {
      expect(out.files).toContain(`${r}/index.m3u8`);
      expect(out.files).toContain(`${r}/init.mp4`);
      expect(out.files).toContain(`${r}/seg_00000.m4s`);
      expect(await readEditList(join(out.dir, r, 'init.mp4'))).toMatchObject({
        mediaTime: AAC_PRIMING_SAMPLES,
      });
    }
    const master = readFileSync(join(out.dir, 'master.m3u8'), 'utf8');
    const variants = [
      ...master.matchAll(
        /BANDWIDTH=(\d+),AVERAGE-BANDWIDTH=(\d+),CODECS="mp4a.40.2"\n(\w+)\/index\.m3u8/g,
      ),
    ].map((m) => ({ name: m[3], peak: Number(m[1]), average: Number(m[2]) }));
    expect(variants.map((v) => v.name)).toEqual(['standard', 'low', 'high']);
    const by = Object.fromEntries(variants.map((v) => [v.name, v.average]));
    expect(by['low']).toBeLessThan(by['standard']);
    expect(by['standard']).toBeLessThan(by['high']);
    for (const v of variants) expect(v.peak).toBeGreaterThanOrEqual(v.average);
  });
});

describe('gapless edit list (AUD-013)', () => {
  // Not a multiple of the 1024-sample AAC frame, so the last frame is padded.
  const SAMPLES = 100_003;

  it('starts after the encoder priming and lasts exactly the source', async () => {
    const src = tone('gapless.wav', 44_100, SAMPLES);
    const { info, out } = await render(src);
    expect(info.samples).toBe(SAMPLES);
    expect(out.gapless).toBe(true);
    expect(await readEditList(join(out.dir, 'standard', 'init.mp4'))).toEqual({
      movieTimescale: 44_100,
      segmentDuration: SAMPLES,
      mediaTime: AAC_PRIMING_SAMPLES,
    });
  });

  it('decodes in phase with the source: the priming silence is not played', async () => {
    const src = tone('phase.wav', 44_100, SAMPLES);
    const { out } = await render(src);
    const a = pcm(src, 44_100);
    const b = pcm(join(out.dir, 'standard', 'index.m3u8'), 44_100);
    // ffmpeg honours the edit's start; it keeps the trailing padding, which
    // AVFoundation trims by the edit's duration.
    expect(b.length - a.length).toBeGreaterThanOrEqual(0);
    expect(b.length - a.length).toBeLessThan(1024);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 4096; i < 40_000; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    // A 1024-sample shift of a 440 Hz tone would correlate at about cos(2π·440·1024/44100) ≈ -0.6.
    expect(dot / Math.sqrt(na * nb)).toBeGreaterThan(0.99);
  });
});

describe('source QC fields', () => {
  it('records the codec family and bit depth of the source', async () => {
    const write = (name: string, buf: Buffer) => {
      const p = join(dir, name);
      writeFileSync(p, buf);
      return p;
    };
    const wav = await probe('ffprobe', write('q.wav', fixtures.wav()), { maxDurationMs: 60_000 });
    const mp3 = await probe('ffprobe', write('q.mp3', fixtures.mp3()), { maxDurationMs: 60_000 });
    expect(wav.ok && wav.result).toMatchObject({ lossless: true, bitsPerSample: 16 });
    expect(mp3.ok && mp3.result).toMatchObject({ lossless: false, bitsPerSample: null });
  });
});
