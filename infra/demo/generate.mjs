// Builds a demo catalog from a data source in infra/demo/catalog/<set>.json:
// the catalog ingest manifest (apps/server/src/modules/catalog/ingest.ts) and one
// synthesised recording per track (CAT-008: no third-party audio, invented names).
//
//   node infra/demo/generate.mjs core         → infra/demo/out/core/manifest.json
//   node infra/demo/generate.mjs expansion    → infra/demo/out/expansion/manifest.json
//
// Audio is generated once per file (delete out/<set> to regenerate). Each release's
// `sound` sets a root, a mode, a tempo and a level; its tracks move through the scale,
// so every track sounds different and loudness varies (normalisation has work to do).
// `format` picks the master: wav16, wav24, hires (24-bit 96 kHz), wav48, flac (24-bit), mp3 (lossy),
// or sine (the plain tones the browser tests were written against).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const set = process.argv[2];
if (!set || !/^[a-z0-9-]+$/.test(set) || !existsSync(resolve(HERE, `catalog/${set}.json`))) {
  process.stderr.write(
    'usage: node infra/demo/generate.mjs <set>  (a file in infra/demo/catalog)\n',
  );
  process.exit(2);
}
const src = JSON.parse(readFileSync(resolve(HERE, `catalog/${set}.json`), 'utf8'));
const OUT = resolve(HERE, 'out', set);
mkdirSync(OUT, { recursive: true });

// ---- references -------------------------------------------------------------------
const names = new Map();
for (const kind of ['labels', 'people', 'artists'])
  for (const e of src[kind] ?? []) {
    if (names.has(e.key)) throw new Error(`duplicate key ${e.key}`);
    names.set(e.key, e.name);
  }
const tracks = [];
for (const r of src.releases) {
  if (names.has(r.key)) throw new Error(`duplicate key ${r.key}`);
  names.set(r.key, r.title);
  r.tracks.forEach((t, i) => {
    t.key ??= `${r.key}-${String(i + 1)}`;
    if (names.has(t.key)) throw new Error(`duplicate key ${t.key}`);
    names.set(t.key, t.title);
    tracks.push({ release: r, track: t, index: i });
  });
}
const need = (key, where) => {
  if (!names.has(key)) throw new Error(`${where}: unknown key "${key}"`);
  return key;
};

// ---- audio ------------------------------------------------------------------------
const MODES = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dorian: [0, 3, 7, 10],
};
/** Scale steps the tracks of a release move through, in semitones from the root. */
const STEPS = [0, 5, 7, 3, 10, 2, 9];
const FORMATS = {
  wav16: { ext: 'wav', rate: 44_100, args: ['-c:a', 'pcm_s16le'] },
  wav24: { ext: 'wav', rate: 44_100, args: ['-c:a', 'pcm_s24le'] },
  hires: { ext: 'wav', rate: 96_000, args: ['-c:a', 'pcm_s24le'] },
  wav48: { ext: 'wav', rate: 48_000, args: ['-c:a', 'pcm_s16le'] },
  flac: {
    ext: 'flac',
    rate: 44_100,
    args: ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'],
  },
  mp3: { ext: 'mp3', rate: 44_100, args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
};

/** ffmpeg runs queued here, a few at a time; synth() returns the file name at once. */
const jobs = [];
function ffmpeg(args, file) {
  jobs.push(
    () =>
      new Promise((done, failed) => {
        const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, file]);
        let err = '';
        p.stderr.on('data', (d) => (err += String(d)));
        p.on('close', (code) => {
          if (code === 0) done();
          else failed(new Error(`ffmpeg failed for ${file}: ${err}`));
        });
      }),
  );
}
async function runJobs() {
  const width = Math.max(1, Math.min(8, availableParallelism() - 1));
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
}

/** A chord over a bass note with a pulse at the release's tempo, faded in and out. */
function synth({ release, track, index }) {
  const fmt = release.format ?? 'wav16';
  const sec = track.sec;
  if (fmt === 'sine') {
    const file = `${track.key}.wav`;
    if (!existsSync(resolve(OUT, file))) {
      ffmpeg(
        [
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${String(track.freq)}:duration=${String(sec)}`,
          '-ac',
          '2',
          '-c:a',
          'pcm_s16le',
        ],
        resolve(OUT, file),
      );
    }
    return file;
  }
  const f = FORMATS[fmt];
  if (!f) throw new Error(`${release.key}: unknown format ${fmt}`);
  const file = `${track.key}.${f.ext}`;
  if (existsSync(resolve(OUT, file))) return file;
  const s = release.sound ?? {};
  const root = (s.root ?? 220) * 2 ** ((STEPS[index % STEPS.length] ?? 0) / 12);
  const chord = (MODES[s.mode ?? 'major'] ?? MODES.major).map((st) => root * 2 ** (st / 12));
  const level = Math.min(0.95, (s.level ?? 0.3) * (1 + ((index % 3) - 1) * 0.15));
  const beat = (s.bpm ?? 90) / 60;
  const voice = (detune) =>
    [
      `0.5*sin(2*PI*${(root / 2 + detune).toFixed(3)}*t)`,
      ...chord.map(
        (hz, i) => `${(0.35 / (i + 1)).toFixed(3)}*sin(2*PI*${(hz + detune).toFixed(3)}*t)`,
      ),
    ].join('+');
  const envelope = `(0.7+0.3*pow(abs(sin(PI*${beat.toFixed(3)}*t)),4))*min(1,t/1.5)*min(1,(${String(sec)}-t)/2)`;
  const channel = (detune) => `${level.toFixed(3)}*(${voice(detune)})/1.6*${envelope}`;
  ffmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      // Quoted: the expressions contain commas, which separate filters otherwise.
      `aevalsrc='${channel(0)}|${channel(0.7)}':s=${String(f.rate)}:d=${String(sec)}`,
      ...f.args,
    ],
    resolve(OUT, file),
  );
  return file;
}

// ---- manifest ---------------------------------------------------------------------
const defaults = src.defaults ?? {};
const credit = (subject, c) => {
  const d = { ...(defaults.credit ?? {}), ...c };
  return {
    subject,
    contributor: need(d.person, `credit of ${subject}`),
    role: d.role,
    ...(d.instrument ? { instrument: d.instrument } : {}),
    ...(d.method ? { creation_method: d.method } : {}),
    ...(d.basis ? { basis: d.basis } : {}),
    ...(d.verification ? { verification_state: d.verification } : {}),
  };
};
const isrc = (date, n) => `ZZRBT${date.slice(2, 4)}${String(n).padStart(5, '0')}`;
const withCodes = set !== 'core';

const recordings = [];
const credits = [];
const claims = [];
const grants = [];
tracks.forEach((t, n) => {
  const { release: r, track: tr } = t;
  recordings.push({
    key: tr.key,
    title: tr.title,
    ...(withCodes ? { isrc: isrc(r.date, n + 1) } : {}),
    artists: (tr.artists ?? r.artists).map((a) => need(a, tr.key)),
    audio: synth(t),
  });
  for (const c of [...(r.credits ?? []), ...(tr.credits ?? [])]) credits.push(credit(tr.key, c));
  const issuerDefault = names.get(r.label) ?? names.get(r.artists[0]);
  for (const c of [...(r.claims ?? []), ...(tr.claims ?? [])]) {
    claims.push({
      subject: tr.key,
      stage: c.stage,
      method: c.method,
      issuer: c.issuer ?? issuerDefault,
      ...(c.basis ? { basis: c.basis } : {}),
      ...(c.verification ? { verification_state: c.verification } : {}),
    });
  }
  const rights = tr.rights === undefined ? r.rights : tr.rights;
  if (rights) {
    grants.push({
      recording: tr.key,
      rights_holder: rights.holder ?? issuerDefault,
      territories: rights.territories,
      uses: rights.uses,
      contract_ref: rights.contract ?? `DEMO-${r.label.toUpperCase()}`,
      ...(rights.until ? { valid_to: rights.until } : {}),
    });
  }
});

const relations = [
  ...(src.relations ?? []).map((r) => ({
    from: need(r.from, 'relation'),
    to: need(r.to, 'relation'),
    type: r.type,
    basis: r.basis,
    ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
    verification_state: r.verification,
    ...(r.license ? { license_status: r.license } : {}),
    ...(r.evidence ? { evidence_ref: r.evidence } : {}),
  })),
  // Band members and label rosters, stated by the labels.
  ...(src.artists ?? []).flatMap((a) => [
    ...(a.members ?? []).map((m) => ({
      from: need(m, `member of ${a.key}`),
      to: a.key,
      type: 'member_of',
      basis: 'verified_fact',
      verification_state: 'distributor_verified',
    })),
    ...(a.label
      ? [
          {
            from: a.key,
            to: need(a.label, `label of ${a.key}`),
            type: 'signed_to',
            basis: 'verified_fact',
            verification_state: 'distributor_verified',
          },
        ]
      : []),
  ]),
];

const manifest = {
  source: src.source,
  artists: (src.artists ?? []).map(({ key, name }) => ({ key, name })),
  people: (src.people ?? []).map(({ key, name }) => ({ key, name })),
  labels: (src.labels ?? []).map(({ key, name }) => ({ key, name })),
  recordings,
  releases: src.releases.map((r, i) => ({
    key: r.key,
    title: r.title,
    type: r.type,
    ...(r.label ? { label: need(r.label, r.key) } : {}),
    date: r.date,
    ...(withCodes ? { upc: `20000000${String(i + 1).padStart(4, '0')}` } : {}),
    artists: r.artists.map((a) => need(a, r.key)),
    tracks: r.tracks.map((t) => t.key),
  })),
  credits,
  relations,
  claims,
  grants,
};
if (jobs.length > 0) process.stdout.write(`synthesising ${String(jobs.length)} recordings…\n`);
await runJobs();
writeFileSync(resolve(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Album offers, created through the operator API once the api runs (scripts/demo.mjs).
const offers = src.releases
  .filter((r) => r.price_krw)
  .map((r) => ({ title: r.title, date: r.date, price_minor: r.price_krw }));
writeFileSync(resolve(OUT, 'offers.json'), `${JSON.stringify(offers, null, 2)}\n`);

process.stdout.write(
  `${resolve(OUT, 'manifest.json')}: ${String(src.releases.length)} releases, ${String(recordings.length)} recordings, ${String(credits.length)} credits, ${String(relations.length)} relations, ${String(offers.length)} offers\n`,
);
