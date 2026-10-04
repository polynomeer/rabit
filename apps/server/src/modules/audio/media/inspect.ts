import { open } from 'node:fs/promises';
import { z } from 'zod';
import { runProcess } from '../../../platform/process.js';

/** Container families accepted by magic-byte sniffing (audio-pipeline §2). */
export type SniffedFormat = 'wav' | 'flac' | 'mp3' | 'ogg' | 'mp4' | 'aiff';

/** Identifies the container from the first bytes. The declared MIME type is never used. */
export async function sniff(filePath: string): Promise<SniffedFormat | null> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    if (bytesRead < 12) return null;
    const ascii = (s: number, e: number) => buf.subarray(s, e).toString('latin1');
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (ascii(0, 4) === 'fLaC') return 'flac';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (ascii(4, 8) === 'ftyp') return 'mp4';
    if (ascii(0, 4) === 'FORM' && (ascii(8, 12) === 'AIFF' || ascii(8, 12) === 'AIFC'))
      return 'aiff';
    if (ascii(0, 3) === 'ID3') return 'mp3';
    // MPEG audio frame sync: 11 set bits, layer III.
    if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0 && ((buf[1] ?? 0) & 0x06) === 0x02) {
      return 'mp3';
    }
    return null;
  } finally {
    await fh.close();
  }
}

const ALLOWED_CODECS = new Set([
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_s16be',
  'pcm_s24be',
  'pcm_s32be',
  'pcm_u8',
  'flac',
  'mp3',
  'aac',
  'alac',
  'vorbis',
  'opus',
]);

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      sample_rate: z.coerce.number().optional(),
      channels: z.number().optional(),
      disposition: z.object({ attached_pic: z.number().optional() }).partial().optional(),
    }),
  ),
  format: z.object({
    format_name: z.string(),
    duration: z.coerce.number().optional(),
  }),
});

export interface ProbeResult {
  codec: string;
  container: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

export type ProbeFailure = 'CORRUPT_MEDIA' | 'UNSUPPORTED_MEDIA' | 'DURATION_EXCEEDED';

/**
 * ffprobe with a timeout and bounded output, followed by strict validation:
 * exactly one audio stream with an allowed codec, no video except cover art,
 * sane sample rate/channels, 0 < duration ≤ max.
 */
export async function probe(
  ffprobePath: string,
  filePath: string,
  opts: { maxDurationMs: number; signal?: AbortSignal },
): Promise<
  { ok: true; result: ProbeResult } | { ok: false; failure: ProbeFailure; reason: string }
> {
  const res = await runProcess(
    ffprobePath,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-print_format',
      'json',
      '-show_entries',
      'stream=codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic:format=format_name,duration',
      filePath,
    ],
    {
      timeoutMs: 30_000,
      maxStdoutBytes: 1_000_000,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );
  if (res.timedOut || res.code !== 0) {
    return {
      ok: false,
      failure: 'CORRUPT_MEDIA',
      reason: res.timedOut ? 'probe timeout' : 'probe failed',
    };
  }
  let parsed;
  try {
    parsed = probeSchema.parse(JSON.parse(res.stdout.toString('utf8')));
  } catch {
    return { ok: false, failure: 'CORRUPT_MEDIA', reason: 'unparseable probe output' };
  }
  const audio = parsed.streams.filter((s) => s.codec_type === 'audio');
  const video = parsed.streams.filter(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  const other = parsed.streams.filter((s) => s.codec_type !== 'audio' && s.codec_type !== 'video');
  if (audio.length !== 1 || video.length > 0 || other.length > 0) {
    return { ok: false, failure: 'UNSUPPORTED_MEDIA', reason: 'stream layout' };
  }
  const a = audio[0];
  if (!a?.codec_name || !ALLOWED_CODECS.has(a.codec_name)) {
    return { ok: false, failure: 'UNSUPPORTED_MEDIA', reason: 'codec' };
  }
  const sampleRate = a.sample_rate ?? 0;
  const channels = a.channels ?? 0;
  if (sampleRate < 8_000 || sampleRate > 192_000 || channels < 1 || channels > 8) {
    return { ok: false, failure: 'UNSUPPORTED_MEDIA', reason: 'sample rate or channels' };
  }
  const durationMs = Math.round((parsed.format.duration ?? 0) * 1000);
  if (!(durationMs > 0)) return { ok: false, failure: 'CORRUPT_MEDIA', reason: 'duration' };
  if (durationMs > opts.maxDurationMs) {
    return { ok: false, failure: 'DURATION_EXCEEDED', reason: 'duration' };
  }
  return {
    ok: true,
    result: {
      codec: a.codec_name,
      container: parsed.format.format_name,
      sampleRate,
      channels,
      durationMs,
    },
  };
}
