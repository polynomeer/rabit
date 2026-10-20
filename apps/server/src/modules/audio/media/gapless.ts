import { open } from 'node:fs/promises';

/**
 * Gapless metadata for the fMP4 HLS rendition (ADR-0008, AUD-013).
 *
 * An AAC encoder prepends `priming` samples of silence and pads the last frame.
 * ffmpeg's HLS muxer writes an empty edit list into `init.mp4` (media_time 0,
 * duration 0), so players play that silence and every track gains about 40 ms at
 * the joins. This rewrites the edit list in place: the movie timescale becomes the
 * sample rate, the edit starts after the priming and lasts exactly the source's
 * samples, so players that honour edit lists (AVFoundation) trim both ends.
 */

/** Encoder delay of ffmpeg's native AAC encoder (LADDER.codec). */
export const AAC_PRIMING_SAMPLES = 1024;

interface Box {
  type: string;
  start: number;
  size: number;
  /** Offset of the payload (after size/type, and the 64-bit size if present). */
  body: number;
}

function boxes(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let off = from;
  while (off + 8 <= to) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let body = off + 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(off + 8));
      body = off + 16;
    } else if (size === 0) {
      size = to - off;
    }
    if (size < 8 || off + size > to) throw new Error(`malformed box ${type}`);
    out.push({ type, start: off, size, body });
    off += size;
  }
  return out;
}

function child(buf: Buffer, parent: Box, type: string): Box {
  const b = boxes(buf, parent.body, parent.start + parent.size).find((x) => x.type === type);
  if (!b) throw new Error(`missing ${type} in ${parent.type}`);
  return b;
}

/** Writes a duration/time pair at `off` for a full box of `version` 0 or 1. */
function writeTimes(buf: Buffer, version: number, off: number, ...values: number[]) {
  values.forEach((v, i) => {
    if (version === 1) buf.writeBigUInt64BE(BigInt(v), off + i * 8);
    else buf.writeUInt32BE(v, off + i * 4);
  });
}

/** Patches `init.mp4` in place; the file size does not change. */
export async function writeGaplessEditList(
  initPath: string,
  g: { sampleRate: number; samples: number; priming: number },
): Promise<void> {
  const fh = await open(initPath, 'r+');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    const moov = boxes(buf, 0, size).find((b) => b.type === 'moov');
    if (!moov) throw new Error('missing moov');

    // mvhd: version, flags, creation, modification, timescale, duration.
    const mvhd = child(buf, moov, 'mvhd');
    const mv = buf.readUInt8(mvhd.body);
    const mvTimes = mvhd.body + 4 + (mv === 1 ? 16 : 8);
    buf.writeUInt32BE(g.sampleRate, mvTimes);
    writeTimes(buf, mv, mvTimes + 4, g.samples);

    const traks = boxes(buf, moov.body, moov.start + moov.size).filter((b) => b.type === 'trak');
    const [trak, ...more] = traks;
    if (!trak || more.length > 0) throw new Error('expected one track');

    // tkhd: version, flags, creation, modification, track id, reserved, duration.
    const tkhd = child(buf, trak, 'tkhd');
    const tv = buf.readUInt8(tkhd.body);
    writeTimes(buf, tv, tkhd.body + 4 + (tv === 1 ? 16 : 8) + 8, g.samples);

    // elst with one entry: segment duration (movie timescale), media time (media timescale).
    const elst = child(buf, child(buf, trak, 'edts'), 'elst');
    const ev = buf.readUInt8(elst.body);
    if (buf.readUInt32BE(elst.body + 4) !== 1) throw new Error('expected one edit');
    writeTimes(buf, ev, elst.body + 8, g.samples, g.priming);

    // The edit's media time is in the track's timescale, which must be the sample rate.
    const mdhd = child(buf, child(buf, trak, 'mdia'), 'mdhd');
    const md = buf.readUInt8(mdhd.body);
    const mediaTimescale = buf.readUInt32BE(mdhd.body + 4 + (md === 1 ? 16 : 8));
    if (mediaTimescale !== g.sampleRate) throw new Error('track timescale is not the sample rate');

    await fh.write(buf, 0, size, 0);
  } finally {
    await fh.close();
  }
}

/** Reads the edit list back (tests and diagnostics). */
export async function readEditList(initPath: string) {
  const fh = await open(initPath, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    const moov = boxes(buf, 0, size).find((b) => b.type === 'moov');
    if (!moov) throw new Error('missing moov');
    const mvhd = child(buf, moov, 'mvhd');
    const mv = buf.readUInt8(mvhd.body);
    const trak = child(buf, moov, 'trak');
    const elst = child(buf, child(buf, trak, 'edts'), 'elst');
    const ev = buf.readUInt8(elst.body);
    const read = (off: number) =>
      ev === 1 ? Number(buf.readBigInt64BE(off)) : buf.readInt32BE(off);
    return {
      movieTimescale: buf.readUInt32BE(mvhd.body + 4 + (mv === 1 ? 16 : 8)),
      segmentDuration:
        ev === 1 ? Number(buf.readBigUInt64BE(elst.body + 8)) : buf.readUInt32BE(elst.body + 8),
      mediaTime: read(elst.body + 8 + (ev === 1 ? 8 : 4)),
    };
  } finally {
    await fh.close();
  }
}
