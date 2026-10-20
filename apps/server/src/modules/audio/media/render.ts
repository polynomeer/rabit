import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../../../platform/process.js';
import { AAC_PRIMING_SAMPLES, trimPlaylistToEdit, writeGaplessEditList } from './gapless.js';

/**
 * Codec ladder (ADR-0008 amendment 2026-10-20, owner decision): three AAC-LC stereo
 * renditions behind one master playlist, so players switch with the network. The
 * low rung is AAC-LC because HE-AAC needs a non-free encoder. Bitrates stay
 * provisional until the listening test (O-26). The sample rate follows the source
 * family (see `outputSampleRate`).
 */
export const LADDER = {
  codec: 'aac',
  /** Listed in master-playlist order: the first is where players start. */
  renditions: [
    { name: 'standard', bitrateKbps: 160 },
    { name: 'low', bitrateKbps: 96 },
    { name: 'high', bitrateKbps: 256 },
  ],
  channels: 2,
  segmentSeconds: 4,
  provisional: true,
} as const;

export type RenditionName = (typeof LADDER.renditions)[number]['name'];

/** Bitrates of the ladder, ascending (what a session advertises). */
export const LADDER_KBPS = LADDER.renditions.map((r) => r.bitrateKbps).sort((a, b) => a - b);

/** Files a rendition directory may hold, and the master playlist (gateway whitelist). */
export const HLS_FILE =
  /^(master\.m3u8|((low|standard|high)\/)?(index\.m3u8|init\.mp4|seg_\d{5}\.m4s))$/;

/**
 * 44.1 kHz for sources of the 44.1 kHz family (CD masters, 88.2, 176.4), 48 kHz
 * otherwise, so the common case is never resampled and the rest is resampled by an
 * integer ratio where possible (ADR-0008 amendment 2026-10-20).
 */
export function outputSampleRate(sourceRate: number): 44_100 | 48_000 {
  return sourceRate % 11_025 === 0 ? 44_100 : 48_000;
}

const SAFE_INPUT = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file,pipe'];

export interface HlsOutput {
  dir: string;
  files: string[];
  toolVersion: string;
  /** Sample rate of the rendition. */
  sampleRate: number;
  /** Edit list written: players trim encoder priming and padding (gapless). */
  gapless: boolean;
}

export async function ffmpegVersion(ffmpegPath: string): Promise<string> {
  const r = await runProcess(ffmpegPath, ['-version'], {
    timeoutMs: 10_000,
    maxStdoutBytes: 100_000,
  });
  return /ffmpeg version (\S+)/.exec(r.stdout.toString('utf8'))?.[1] ?? 'unknown';
}

/** Peak and average bits per second of a rendition, from its playlist and segment sizes. */
async function measureBandwidth(dir: string): Promise<{ peak: number; average: number }> {
  const playlist = await readFile(join(dir, 'index.m3u8'), 'utf8');
  let peak = 0;
  let bits = 0;
  let seconds = 0;
  let duration = 0;
  for (const line of playlist.split('\n')) {
    const inf = /^#EXTINF:([\d.]+)/.exec(line);
    if (inf) duration = Number(inf[1]);
    else if (/^seg_\d{5}\.m4s$/.test(line.trim()) && duration > 0) {
      const b = (await stat(join(dir, line.trim()))).size * 8;
      peak = Math.max(peak, b / duration);
      bits += b;
      seconds += duration;
    }
  }
  return { peak: Math.ceil(peak), average: Math.ceil(seconds > 0 ? bits / seconds : 0) };
}

/**
 * Transcodes to the HLS ladder: one decode, one encode per rendition into
 * `hls/<rendition>/`, then `hls/master.m3u8`. Returns the files relative to
 * `hls/`. A failure means ffmpeg rejected the input (treated as permanent).
 */
export async function transcodeHls(
  ffmpegPath: string,
  input: string,
  workDir: string,
  opts: {
    durationMs: number;
    /** Source sample rate and length in source samples (probe). */
    sampleRate: number;
    samples: number;
    signal?: AbortSignal;
  },
): Promise<{ ok: true; output: HlsOutput } | { ok: false; timedOut: boolean; stderr: string }> {
  const dir = join(workDir, 'hls');
  const rate = outputSampleRate(opts.sampleRate);
  const outputs: string[] = [];
  for (const r of LADDER.renditions) {
    const rdir = join(dir, r.name);
    await mkdir(rdir, { recursive: true });
    outputs.push(
      ...['-map', '0:a:0', '-vn', '-sn', '-dn'],
      ...['-c:a', 'aac', '-b:a', `${r.bitrateKbps}k`],
      ...['-ar', String(rate), '-ac', String(LADDER.channels)],
      ...['-f', 'hls', '-hls_time', String(LADDER.segmentSeconds), '-hls_playlist_type', 'vod'],
      ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
      ...['-hls_segment_filename', join(rdir, 'seg_%05d.m4s'), join(rdir, 'index.m3u8')],
    );
  }
  // Decoding once and encoding three times costs about three single encodes.
  const timeoutMs = Math.max(180_000, Math.ceil(opts.durationMs * 6));
  const res = await runProcess(
    ffmpegPath,
    [...SAFE_INPUT, '-loglevel', 'error', '-i', input, '-threads', '2', ...outputs],
    { timeoutMs, maxStdoutBytes: 1_000_000, ...(opts.signal ? { signal: opts.signal } : {}) },
  );
  if (res.timedOut || res.code !== 0)
    return { ok: false, timedOut: res.timedOut, stderr: res.stderr };

  const files: string[] = [];
  let gapless = true;
  const variants: string[] = [];
  for (const r of LADDER.renditions) {
    const rdir = join(dir, r.name);
    const own = (await readdir(rdir)).filter((f) => HLS_FILE.test(f)).sort();
    if (!own.includes('index.m3u8') || !own.includes('init.mp4')) {
      return { ok: false, timedOut: false, stderr: `missing hls outputs for ${r.name}` };
    }
    files.push(...own.map((f) => `${r.name}/${f}`));
    // A layout this code does not expect (another ffmpeg version) costs gapless
    // playback, never the rendition itself.
    const g = {
      sampleRate: rate,
      samples: Math.round((opts.samples * rate) / opts.sampleRate),
      priming: AAC_PRIMING_SAMPLES,
    };
    const edited = await writeGaplessEditList(join(rdir, 'init.mp4'), g).then(
      () => true,
      () => false,
    );
    // The playlist must last what the edit list leaves, or players wait at the end
    // for media that was trimmed away (hls.js never reaches `ended`).
    if (edited) await trimPlaylistToEdit(join(rdir, 'index.m3u8'), g);
    gapless &&= edited;
    const bw = await measureBandwidth(rdir);
    variants.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bw.peak},AVERAGE-BANDWIDTH=${bw.average},CODECS="mp4a.40.2"`,
      `${r.name}/index.m3u8`,
    );
  }
  await writeFile(
    join(dir, 'master.m3u8'),
    ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', ...variants, ''].join('\n'),
  );
  files.unshift('master.m3u8');
  return {
    ok: true,
    output: { dir, files, toolVersion: await ffmpegVersion(ffmpegPath), sampleRate: rate, gapless },
  };
}

/** EBU R128 integrated loudness and true peak. Analysis failures return null (non-blocking). */
export async function measureLoudness(
  ffmpegPath: string,
  input: string,
  opts: { durationMs: number; signal?: AbortSignal },
): Promise<{ integratedLufs: number; truePeakDbtp: number } | null> {
  const res = await runProcess(
    ffmpegPath,
    [
      ...SAFE_INPUT,
      '-loglevel',
      'info',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    {
      timeoutMs: Math.max(60_000, Math.ceil(opts.durationMs * 2)),
      maxStdoutBytes: 1_000_000,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );
  if (res.code !== 0) return null;
  const summary = res.stderr.slice(res.stderr.lastIndexOf('Summary:'));
  const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1];
  const p = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  if (!i || !p || i === '-inf') return null;
  return { integratedLufs: Number(i), truePeakDbtp: p === '-inf' ? -144 : Number(p) };
}

/**
 * Waveform peaks (≈2 per second, ≤ 4000), normalized 0..1, computed by streaming
 * decoded 16-bit mono PCM so memory stays constant for long files.
 */
export async function computeWaveform(
  ffmpegPath: string,
  input: string,
  opts: { durationMs: number; signal?: AbortSignal },
): Promise<{ samplesPerPeak: number; sampleRate: number; peaks: number[] } | null> {
  const sampleRate = 2_000;
  const target = Math.min(4_000, Math.max(1, Math.ceil((opts.durationMs / 1000) * 2)));
  const samplesPerPeak = Math.max(1, Math.floor(((opts.durationMs / 1000) * sampleRate) / target));
  const peaks: number[] = [];
  let current = 0;
  let count = 0;
  let carry: Buffer | null = null;
  const res = await runProcess(
    ffmpegPath,
    [
      ...SAFE_INPUT,
      '-loglevel',
      'error',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      '-',
    ],
    {
      timeoutMs: Math.max(60_000, Math.ceil(opts.durationMs * 2)),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onStdout: (chunk) => {
        let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
        const usable = buf.length - (buf.length % 2);
        carry = usable < buf.length ? buf.subarray(usable) : null;
        buf = buf.subarray(0, usable);
        for (let o = 0; o < buf.length; o += 2) {
          const v = Math.abs(buf.readInt16LE(o)) / 32768;
          if (v > current) current = v;
          if (++count === samplesPerPeak) {
            peaks.push(Math.round(current * 1000) / 1000);
            current = 0;
            count = 0;
          }
        }
      },
    },
  );
  if (res.code !== 0) return null;
  if (count > 0) peaks.push(Math.round(current * 1000) / 1000);
  return { samplesPerPeak, sampleRate, peaks };
}
