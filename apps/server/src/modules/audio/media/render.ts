import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../../../platform/process.js';

/**
 * Provisional codec ladder (ADR-0008): one AAC-LC 48 kHz stereo rendition with
 * fMP4 HLS segments. Numbers are placeholders pending listening tests.
 */
export const LADDER = {
  codec: 'aac',
  bitrateKbps: 160,
  sampleRate: 48_000,
  channels: 2,
  segmentSeconds: 4,
  provisional: true,
} as const;

const SAFE_INPUT = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file,pipe'];

export interface HlsOutput {
  dir: string;
  files: string[];
  toolVersion: string;
}

export async function ffmpegVersion(ffmpegPath: string): Promise<string> {
  const r = await runProcess(ffmpegPath, ['-version'], {
    timeoutMs: 10_000,
    maxStdoutBytes: 100_000,
  });
  return /ffmpeg version (\S+)/.exec(r.stdout.toString('utf8'))?.[1] ?? 'unknown';
}

/** Transcodes to HLS. Returns null when ffmpeg rejects the input (treated as permanent). */
export async function transcodeHls(
  ffmpegPath: string,
  input: string,
  workDir: string,
  opts: { durationMs: number; signal?: AbortSignal },
): Promise<{ ok: true; output: HlsOutput } | { ok: false; timedOut: boolean; stderr: string }> {
  const dir = join(workDir, 'hls');
  await mkdir(dir, { recursive: true });
  const timeoutMs = Math.max(120_000, Math.ceil(opts.durationMs * 4));
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
      '-vn',
      '-sn',
      '-dn',
      '-threads',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      `${LADDER.bitrateKbps}k`,
      '-ar',
      String(LADDER.sampleRate),
      '-ac',
      String(LADDER.channels),
      '-f',
      'hls',
      '-hls_time',
      String(LADDER.segmentSeconds),
      '-hls_playlist_type',
      'vod',
      '-hls_segment_type',
      'fmp4',
      '-hls_fmp4_init_filename',
      'init.mp4',
      '-hls_segment_filename',
      join(dir, 'seg_%05d.m4s'),
      join(dir, 'index.m3u8'),
    ],
    { timeoutMs, maxStdoutBytes: 1_000_000, ...(opts.signal ? { signal: opts.signal } : {}) },
  );
  if (res.timedOut || res.code !== 0)
    return { ok: false, timedOut: res.timedOut, stderr: res.stderr };
  const files = (await readdir(dir))
    .filter((f) => /^(index\.m3u8|init\.mp4|seg_\d{5}\.m4s)$/.test(f))
    .sort();
  if (!files.includes('index.m3u8') || !files.includes('init.mp4')) {
    return { ok: false, timedOut: false, stderr: 'missing hls outputs' };
  }
  return { ok: true, output: { dir, files, toolVersion: await ffmpegVersion(ffmpegPath) } };
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
