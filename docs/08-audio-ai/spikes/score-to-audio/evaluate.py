"""Compare OMR MusicXML output against the Mutopia MIDI ground truth.

Both sides become a sequence of note events ordered by (onset, pitch).
The OMR output covers only page 1, so it is aligned semi-globally against
the full ground truth (free leading/trailing ground-truth gaps).

Metrics per (piece, condition, engine):
  pitch_f1     - F1 of exactly matching MIDI pitches in the alignment
  edits_per_100 - substitutions+insertions+deletions per 100 ground-truth
                  notes in the aligned span: a proxy for correction effort
  dur_acc      - share of pitch-matched notes whose duration also matches
A constant octave offset (e.g. guitar written an octave above sounding)
is searched over {-12, 0, +12} and the best is kept.
"""

import json
import pathlib
import sys
import warnings

import music21 as m21
import numpy as np

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).parent
CONDS = ["clean", "mild", "harsh"]


def events(path: pathlib.Path):
    s = m21.converter.parse(str(path), quantizePost=True)
    out = []
    for n in s.flatten().notes:
        ql = float(n.duration.quarterLength)
        if ql <= 0:  # grace notes
            continue
        on = float(n.getOffsetInHierarchy(s))
        for p in n.pitches:
            out.append((round(on * 12) / 12, int(p.midi), round(ql * 12) / 12))
    out.sort()
    return out


def align(pred, gt):
    """Semi-global edit distance; returns (matches, edits, span, dur_ok)."""
    P, G = len(pred), len(gt)
    pp = np.array([e[1] for e in pred])
    gp = np.array([e[1] for e in gt])
    D = np.zeros((P + 1, G + 1), np.int32)
    D[:, 0] = np.arange(P + 1)
    # D[0, :] = 0: free leading gap in ground truth
    for i in range(1, P + 1):
        sub = D[i - 1, :-1] + (gp != pp[i - 1])
        row = np.minimum(sub, D[i - 1, 1:] + 1)
        # deletions (skip a gt note) chain left-to-right within the row:
        # r[j] = min_k<=j (c[k] + j - k), i.e. a running minimum of c - j
        c = np.concatenate(([D[i, 0]], row))
        idx = np.arange(G + 1)
        D[i] = np.minimum.accumulate(c - idx) + idx
    j_end = int(np.argmin(D[P]))
    edits = int(D[P, j_end])
    i, j, matches, dur_ok = P, j_end, 0, 0
    while i > 0 and j > 0:
        if D[i, j] == D[i - 1, j - 1] + (gp[j - 1] != pp[i - 1]):
            if gp[j - 1] == pp[i - 1]:
                matches += 1
                dur_ok += pred[i - 1][2] == gt[j - 1][2]
            i, j = i - 1, j - 1
        elif D[i, j] == D[i - 1, j] + 1:
            i -= 1
        else:
            j -= 1
    span = j_end - j  # ground-truth notes covered by the page
    return matches, edits, span, dur_ok


def score(pred_path, gt):
    try:
        pred = events(pred_path)
    except Exception as e:  # unparsable output counts as a failure
        return {"error": f"{type(e).__name__}: {e}"[:120]}
    if not pred:
        return {"error": "no notes"}
    best = None
    for shift in (-12, 0, 12):
        shifted = [(o, p + shift, d) for o, p, d in pred]
        m, ed, span, dok = align(shifted, gt)
        if best is None or ed < best[1]:
            best = (m, ed, span, dok, shift)
    m, ed, span, dok, shift = best
    prec = m / len(pred)
    rec = m / span if span else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "pred_notes": len(pred),
        "gt_span": span,
        "pitch_f1": round(f1, 3),
        "edits_per_100": round(100 * ed / max(span, 1), 1),
        "dur_acc": round(dok / m, 3) if m else 0.0,
        "octave_shift": shift,
    }


def main():
    engines = {
        "oemer": lambda stem: ROOT / "out/oemer" / stem / f"{stem}.musicxml",
        "homr": lambda stem: ROOT / "out/homr" / f"{stem}.musicxml",
    }
    results = []
    for mid in sorted((ROOT / "corpus").glob("*.mid")):
        gt = events(mid)
        for cond in CONDS:
            stem = f"{mid.stem}-{cond}"
            for eng, loc in engines.items():
                p = loc(stem)
                r = score(p, gt) if p.exists() else {"error": "no output"}
                r.update(piece=mid.stem, cond=cond, engine=eng)
                results.append(r)
                print(json.dumps(r, ensure_ascii=False), file=sys.stderr)
    (ROOT / "results.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
