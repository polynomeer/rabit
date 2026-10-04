import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Self-generated test audio (CAT-008: no third-party recordings in fixtures).
 * Generated once per process with ffmpeg.
 */
const dir = mkdtempSync(join(tmpdir(), 'rabit-fixtures-'));
const cache = new Map<string, Buffer>();

function ffmpeg(name: string, args: string[]): Buffer {
  const hit = cache.get(name);
  if (hit) return hit;
  const out = join(dir, name);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, out]);
  const buf = readFileSync(out);
  cache.set(name, buf);
  return buf;
}

export const fixtures = {
  /** 3 s, 440 Hz sine, 44.1 kHz stereo 16-bit WAV. */
  wav: () =>
    ffmpeg('tone.wav', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3:sample_rate=44100',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
    ]),
  /** 2 s FLAC. */
  flac: () =>
    ffmpeg('tone.flac', ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-c:a', 'flac']),
  /** 2 s MP3. */
  mp3: () =>
    ffmpeg('tone.mp3', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=550:duration=2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
    ]),
  /** 6 s WAV, longer than a 5 s duration cap. */
  longWav: () =>
    ffmpeg('long.wav', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:a', 'pcm_s16le']),
  /** Video-only MP4 (no audio stream). */
  videoOnly: () =>
    ffmpeg('video.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x64:rate=5',
      '-pix_fmt',
      'yuv420p',
    ]),
  /** Random bytes. */
  random: () => {
    const hit = cache.get('random');
    if (hit) return hit;
    const b = randomBytes(64 * 1024);
    cache.set('random', b);
    return b;
  },
  /** Plain text renamed to .wav. */
  text: () => Buffer.from('this is not audio, just text pretending to be a wav file\n'.repeat(100)),
  /** RIFF/WAVE magic followed by garbage. */
  fakeWav: () =>
    Buffer.concat([Buffer.from('RIFF\x24\x00\x01\x00WAVEjunk', 'latin1'), randomBytes(32 * 1024)]),
};
