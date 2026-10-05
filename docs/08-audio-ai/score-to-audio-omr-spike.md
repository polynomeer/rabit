# Score-to-Audio — OMR Accuracy and Rendering Spike

- Status: spike result (2026-10-05). **Evidence only; decides nothing.** Requirements: [PRD §7.1](../01-requirements/prd.md) STU-010..016. Open questions: [SC-03, SC-06](../00-product/open-questions.md).
- Question: can a phone photo of a printed score become a playable, correctable score reliably enough that STU-010/011 is worth building, and what does the correction step (STU-011) have to handle?
- Scripts (throwaway, reproducible): [spikes/score-to-audio/](spikes/score-to-audio/). Raw numbers: [results.json](spikes/score-to-audio/results.json).

## 1. Summary

| Finding | Evidence |
|---|---|
| Printed scores are recognisable from phone-quality photos. With the better engine, the median page needs **1.4–5 note edits per 100 notes** | homr, §4 |
| The two open-source engines are far apart. oemer (MIT) degrades sharply on photos and crashes on most strong-distortion images; homr (AGPL-3.0) holds up | §4 |
| **Rhythm is the weak point, not pitch.** Pitch F1 is ~0.97–0.99, but implied tuplets (only the first "3" printed) were read as plain eighths, making 70% of Moonlight durations wrong. Dotted/16th figures also slip | §5 |
| **Page capture is a product step.** The only homr failure was a photo whose page edge was not found. Contour-based page detection failed on 3/7 strong-shadow photos | §3, §5 |
| Rendering with style and instrument options is cheap and rule-based: MusicXML → styled MIDI → FluidSynth with a permissively licensed SoundFont, in about 1 s per minute of audio | §6 |
| The engine choice is a licensing decision. The engine that works is AGPL-3.0, so running it server-side needs legal/ADR review (SC-03) | §7 |

Recommendation for SC-06 (the product owner decides): the spike does **not** rule out STU-010. If it continues, scope the first version to **printed, single-page, phone-captured scores with a guided capture step and a rhythm-focused correction UI**, and keep handwritten scores and automatic arrangement out of scope.

## 2. Method

**Corpus.** Seven pieces from the [Mutopia Project](https://www.mutopiaproject.org/). Each has a LilyPond-typeset PDF and a MIDI file made from the same source, which is used as ground truth. Page 1 of each was used.

| Piece | Texture | Licence |
|---|---|---|
| Traditional, *Flee Bird* (fleebird) | melody + chordal accompaniment, dotted rhythms | Public Domain |
| Bach/Petzold, Menuet BWV Anh. 115 (anna-magdalena-05) | 2-voice keyboard | Public Domain |
| Bach, chorale BWV 259 | SATB, 4 voices on 2 staves | CC BY-SA 4.0 |
| Schumann, Op. 68 No. 3 | easy piano | CC BY-SA 3.0 |
| Beethoven, Op. 27 No. 2 mvt 1 (moonlight) | piano, implied triplets | CC BY-SA 2.5 |
| Bach, BWV 1041 mvt 1, violin solo part | single staff, dense | CC BY-SA 4.0 |
| Carcassi, guitar method No. 22 | guitar, written an octave above sounding pitch | CC BY 3.0 |

**Capture conditions** (`make_images.py`). Each page was rendered at 300 dpi, then:
- `clean`: the 300 dpi render, standing in for a flatbed scan.
- `mild`: simulated phone photo with a small perspective tilt (±4%), a soft hand/phone shadow, blur σ 1.2, noise, JPEG q85, about 1400 px wide.
- `harsh`: simulated phone photo with a strong tilt (±10%), a hard shadow, blur σ 2.2, more noise, JPEG q60, about 1000 px wide.

Phone images were then rectified by a simple largest-quadrilateral page detector (OpenCV), which is what a capture UI would do. If no page was found, the raw photo was passed on.

**Limits of this setup.** The photos are synthetic, not real phone pictures: there is no paper curl, no motion blur and no mixed lighting. The corpus is small (7 pages) and uses a single engraver (LilyPond); real users will also photograph commercial engravings. Treat the numbers as an upper bound for printed music and as a relative comparison of engines.

**Engines.**

| Engine | Version | Licence | Mean time/page (M1 Max, CPU) |
|---|---|---|---|
| [oemer](https://github.com/BreezeWhite/oemer) | 0.1.5 | MIT | about 5 min cold (segmentation models) |
| [homr](https://github.com/liebharc/homr) | 0.7.0 | AGPL-3.0 | about 31 s |

oemer needed two local compatibility patches before it ran: numpy ≥1.24 removed `np.int`, and OpenCV 5 changed the `HoughLinesP` output shape (pinned to OpenCV 4.14). The repository's last push was 2025-04. Pages where oemer's deskew step crashed were retried once with deskew disabled (`-d`), and the better result was kept. Audiveris (AGPL-3.0, Java desktop app) was not tested.

**Metrics** (`evaluate.py`). Both sides become note events (onset, MIDI pitch, duration) ordered by onset, then pitch. The OMR page is aligned against the full ground truth with a semi-global edit distance, so the page may match any span.
- `pitch F1`: share of exactly matching pitches in the alignment.
- `edits/100`: substitutions + insertions + deletions per 100 ground-truth notes in the aligned span. This is a proxy for how much the user must correct (STU-011). Wrong rhythm that reorders notes across voices also costs edits.
- `dur`: share of pitch-matched notes whose duration also matches.
- A constant octave shift (−12/0/+12) is allowed, which covers guitar notation.

## 3. Capture result

| Condition | Page found by the contour detector |
|---|---|
| mild | 7/7 |
| harsh | 4/7 |

All three misses were caused by the shadow merging into the background under Otsu thresholding. A production capture flow should use a live edge overlay with manual corner adjustment, or a learned document detector, before recognition.

## 4. Recognition accuracy

Medians over the pages each engine completed:

| Engine | Condition | Completed | Pitch F1 | Edits / 100 notes | Duration accuracy |
|---|---|---|---|---|---|
| homr | clean | 7/7 | 0.98 | 3.5 | 0.90 |
| homr | mild | 7/7 | 0.99 | 1.4 | 0.90 |
| homr | harsh | 6/7 | 0.97 | 5.0 | 0.91 |
| oemer | clean | 7/7 | 0.95 | 6.0 | 0.79 |
| oemer | mild | 7/7 | 0.81 | 18.6 | 0.81 |
| oemer | harsh | 1/7 | 0.17 | 209.2 | 0.05 |

Per page (homr):

| Piece | clean F1 / ed / dur | mild | harsh |
|---|---|---|---|
| Menuet | 1.00 / 0.0 / 1.00 | 0.99 / 0.5 / 1.00 | failed (page not found) |
| Chorale BWV 259 | 1.00 / 0.0 / 1.00 | 1.00 / 0.0 / 1.00 | 1.00 / 0.0 / 1.00 |
| Schumann | 0.96 / 3.6 / 1.00 | 0.99 / 1.4 / 0.99 | 0.97 / 3.2 / 0.98 |
| Moonlight | 0.99 / 1.0 / **0.29** | 1.00 / 0.5 / **0.31** | 0.98 / 3.0 / **0.28** |
| Guitar No. 22 | 0.97 / 5.6 / 0.88 | 0.97 / 5.6 / 0.89 | 0.96 / 6.8 / 0.92 |
| Violin BWV 1041 | 0.98 / 3.5 / 0.90 | 0.98 / 3.3 / 0.90 | 0.76 / 31.0 / 0.85 (page not found) |
| Flee Bird | 0.80 / 30.7 / 0.90 | 0.80 / 30.7 / 0.90 | 0.69 / 43.3 / 0.90 |

The few "mild better than clean" cases are small and not explained by this spike; treat them as noise.

## 5. Error patterns (what STU-011 must handle)

1. **Implied tuplets.** In Moonlight only the first triplet carries a "3"; homr read the rest as eighths. Every pitch is right, yet playback is rhythmically wrong and the bars overflow. The correction UI needs a "make this passage triplets" bulk action. A bar-duration check (each bar's notes must sum to the time signature) can flag these bars automatically.
2. **Dotted and 16th figures.** In Flee Bird the swapped long/short values reordered notes between the melody and the accompaniment, and one bar was lost, shifting what followed. Again, a bar-sum check would flag it.
3. **Missed page → total failure.** The engine either fails outright or reads a distorted page badly. The quality gate belongs in capture, not after recognition.
4. **Octave transposition.** The guitar is written an octave above sounding pitch; the engine reads written pitch. Rendering must apply the instrument's transposition (the user chooses the instrument, as in STU-013).
5. **Not observed, because the corpus has none:** handwritten scores, lyrics, multi-page continuity, repeats with alternative endings, ornaments realised in playback, and percussion.

## 6. Rendering with style and instrument options

`render.py` turns recognised MusicXML into audio:

- **Styles** are rule-based interpretation parameters, not ML:
  - `straight`: metronomic with flat velocity, like notation-app playback.
  - `expressive`: about 15% ritardando into each 4-bar phrase end, a dynamic swell over the phrase, louder higher notes, a softer bass and ±20 ms onset jitter.
  - `swing`: off-beat eighths at a 2:1 long-short ratio.
- **Instruments**: the whole score can be played on piano or strings (low part on cello), or an instrument can be added. In the demo a flute doubles the top line an octave up. Generating new voices (arrangement) is out of scope, as STU-013 says.
- **Synthesis**: [FluidSynth](https://www.fluidsynth.org/) 2.6 (LGPL-2.1) with the [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) v2.0.3 SoundFont. Its licence allows unrestricted private and commercial use, but the author states that the origin of some samples cannot be fully confirmed, which is a point for SC-03. A one-minute piece renders in about 1 s on CPU.

Demo renders of the recognised Menuet (homr, clean): straight / expressive / swing piano, expressive strings, and expressive piano with an added flute. There is also a Moonlight render that makes the tuplet error audible. These files are kept outside the repository: they are build outputs, not documentation.

The output sounds like a General MIDI demo, not a performance. Realistic instruments would need commercial sample libraries, which usually restrict server-side rendering and redistribution (SC-03), or neural synthesis, which is a separate research question.

## 7. Implications for open questions (input, not decisions)

- **SC-03 (engines and licences).** The engine that works (homr) is AGPL-3.0. Running it as a network service may require offering source to users; options are legal review, an isolated service boundary, on-device processing (homr has an Android port, Andromr), a commercial OMR SDK, or training our own model. oemer is MIT-licensed but not competitive on photos and needs patches to run. Needs an ADR before any implementation.
- **SC-06 (scope).** The evidence supports printed, single-page, phone-captured scores with guided capture. Handwritten scores, multi-page scores and automatic arrangement were not tested and should stay out of the first scope.
- **SC-04 (cost).** About 30 s of CPU per page with homr (or about 5 min with oemer) means a queued background job (STU-010) with per-user quotas, not a synchronous request.
- **STU-011.** The correction UI is mainly a **rhythm** editor: bar-sum validation, tuplet bulk actions and a side-by-side image overlay. Pitch corrections are rare on printed music.

## 8. Reproduce

```bash
# inside a scratch directory containing the scripts and a corpus/ folder of <piece>.pdf + <piece>.mid
uv venv -p 3.11 .venv && uv pip install -p .venv oemer music21 pymupdf "opencv-python<5" "opencv-python-headless<5" mido
uv venv -p 3.12 .venv-homr && uv pip install -p .venv-homr 'homr[cpu]'
.venv/bin/python make_images.py          # images/<piece>-{clean,mild,harsh}.png
./run_oemer.sh images/<piece>-<cond>.png # out/oemer/<stem>/<stem>.musicxml
.venv-homr/bin/homr <image>              # writes <image>.musicxml next to the image; copy into out/homr/
.venv/bin/python evaluate.py             # results.json
.venv/bin/python render.py out/homr/<stem>.musicxml audio/<name> expressive piano+flute
```

oemer also needs the local patch that replaces `np.int`/`np.float`/`np.bool` with the builtins (see §2).
