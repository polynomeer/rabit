"""Render OMR MusicXML to audio with a performance style and instrument choice.

usage: render.py <in.musicxml> <out-stem> <style> <instrumentation>
  style:           straight | expressive | swing
  instrumentation: piano | strings | piano+flute
Writes <out-stem>.mid and <out-stem>.wav (FluidSynth + GeneralUser GS).
Styles are rule-based interpretation parameters, not ML:
  straight   - metronomic, flat velocity (what a notation app plays back)
  expressive - phrase-level rubato (slow into 4-bar phrase ends), melodic
               dynamics (louder when higher, phrase swell), small onset
               jitter, bass slightly softer than melody
  swing      - off-beat eighths delayed to a 2:1 long-short feel
"""

import math
import pathlib
import random
import subprocess
import sys

import mido
import music21 as m21

ROOT = pathlib.Path(__file__).parent
SF2 = ROOT / "GeneralUser-GS.sf2"
GM = {"piano": 0, "strings": 48, "flute": 73, "cello": 42}
TICKS = 960
BPM = 96


def parts_events(path):
    s = m21.converter.parse(str(path))
    parts = []
    for part in s.parts:
        ev = []
        for n in part.flatten().notes:
            ql = float(n.duration.quarterLength)
            if ql <= 0:
                continue
            on = float(n.getOffsetInHierarchy(part))
            for p in n.pitches:
                ev.append([on, ql, int(p.midi)])
        parts.append(sorted(ev))
    ts = s.recurse().getElementsByClass(m21.meter.TimeSignature).first()
    bar = float(ts.barDuration.quarterLength) if ts else 4.0
    return parts, bar


def style_time(q, style, bar):
    """Map a score position (quarters) to performance position (quarters at BPM)."""
    if style == "swing":
        beat, frac = divmod(q, 1.0)
        if abs(frac - 0.5) < 1e-6:
            return beat + 2 / 3
        return q
    if style == "expressive":
        phrase = 4 * bar
        # integral of a tempo curve that slows ~15% toward each phrase end
        k, x = divmod(q, phrase)
        u = x / phrase
        stretch = lambda t: t + 0.15 * t**3  # integral of the tempo factor 1 + 0.45 t²
        return k * phrase * stretch(1.0) + phrase * stretch(u)
    return q


def velocity(pitch, q, style, bar, is_bass, rng):
    if style != "expressive":
        return 80
    phrase = 4 * bar
    swell = math.sin(math.pi * ((q % phrase) / phrase))  # rise and fall
    v = 62 + 22 * swell + 0.6 * (pitch - 64)
    if is_bass:
        v -= 12
    return int(max(25, min(115, v + rng.uniform(-5, 5))))


def build_midi(parts, bar, style, inst):
    rng = random.Random(1)
    mf = mido.MidiFile(ticks_per_beat=TICKS)
    meta = mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM))])
    mf.tracks.append(meta)
    layout = []  # (events, program, channel, transpose, is_bass)
    melody = parts[0] if parts else []
    low = sorted(parts, key=lambda ev: sum(p for _, _, p in ev) / max(len(ev), 1))
    base = {"piano": "piano", "strings": "strings", "piano+flute": "piano"}[inst]
    for i, ev in enumerate(parts):
        is_bass = len(parts) > 1 and ev is low[0]
        prog = GM["cello"] if base == "strings" and is_bass else GM[base]
        layout.append((ev, prog, i, 0, is_bass))
    if inst == "piano+flute":
        # Added instrument: double the top line of the upper part an octave up
        top = {}
        for on, ql, p in melody:
            if on not in top or p > top[on][2]:
                top[on] = [on, ql, p]
        layout.append((sorted(top.values()), GM["flute"], len(parts) if len(parts) < 9 else 10, 12, False))
    for ev, prog, ch, tr, is_bass in layout:
        msgs = []
        for on, ql, p in ev:
            jit = rng.uniform(-0.02, 0.02) if style == "expressive" else 0
            t0 = style_time(on, style, bar) + jit
            t1 = style_time(on + ql, style, bar) - 0.02  # tiny release gap
            v = velocity(p, on, style, bar, is_bass, rng)
            msgs.append((max(t0, 0), 1, mido.Message("note_on", channel=ch, note=p + tr, velocity=v)))
            msgs.append((max(t1, t0 + 0.05), 0, mido.Message("note_off", channel=ch, note=p + tr)))
        msgs.sort(key=lambda m: (m[0], m[1]))
        track = mido.MidiTrack([mido.Message("program_change", channel=ch, program=prog)])
        if prog == GM["flute"]:
            track.append(mido.Message("control_change", channel=ch, control=7, value=70))
        last = 0
        for t, _, m in msgs:
            tick = int(round(t * TICKS))
            m.time = tick - last
            last = tick
            track.append(m)
        mf.tracks.append(track)
    return mf


def main():
    src, stem, style, inst = sys.argv[1:5]
    parts, bar = parts_events(src)
    mf = build_midi(parts, bar, style, inst)
    mid = pathlib.Path(f"{stem}.mid")
    mf.save(mid)
    wav = pathlib.Path(f"{stem}.wav")
    subprocess.run(
        ["fluidsynth", "-ni", "-g", "1.6", "-r", "44100", "-F", str(wav), str(SF2), str(mid)],
        check=True,
        capture_output=True,
    )
    print(wav, f"{mf.length:.1f}s")


if __name__ == "__main__":
    main()
