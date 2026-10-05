/**
 * Performance baseline (Playbook Phase 22). Runs against already-started api,
 * worker and media processes (built output) and prints a JSON report.
 *
 *   pnpm build && (start api/worker/media) && pnpm --filter @rabit/server bench
 *
 * Measures real numbers on the current machine; it does not extrapolate to
 * 10k/100k/1M users (see docs/10-testing/performance-baseline.md).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import autocannon from 'autocannon';
import { sql } from 'kysely';
import { createContext } from '../src/app/context.js';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { loadConfig } from '../src/platform/config.js';
import { createLogger } from '../src/platform/logger.js';

const API = process.env['BENCH_API'] ?? 'http://localhost:8080';
const DURATION = Number(process.env['BENCH_SECONDS'] ?? 10);
const CONNECTIONS = Number(process.env['BENCH_CONNECTIONS'] ?? 20);

const config = loadConfig();
const ctx = createContext(config, createLogger({ level: 'silent', name: 'bench' }));
const out: Record<string, unknown> = {
  machine: { cpus: (await import('node:os')).cpus().length, node: process.version },
};

async function json<T = unknown>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as T,
    headers: res.headers,
  };
}

async function token(subject: string, operator = false): Promise<string> {
  const r = await json<{ access_token: string }>('POST', '/dev/token', null, { subject, operator });
  return r.body.access_token;
}

function wav(seconds: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'rabit-bench-'));
  const f = join(dir, 'a.wav');
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    f,
  ]);
  return readFileSync(f);
}

async function upload(t: string, bytes: Buffer): Promise<string> {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const i = await json<{
    upload: { upload_id: string };
    upload_url: string;
    upload_headers: Record<string, string>;
  }>('POST', '/v1/uploads', t, {
    intent: 'private_upload',
    size_bytes: bytes.length,
    sha256: sha,
  });
  await fetch(i.body.upload_url, { method: 'PUT', headers: i.body.upload_headers, body: bytes });
  const f = await json<{ audio_source_id: string }>(
    'POST',
    `/v1/uploads/${i.body.upload.upload_id}/finalize`,
    t,
    undefined,
    {
      'idempotency-key': `bench-${randomUUID()}`,
    },
  );
  return f.body.audio_source_id;
}

async function waitReady(ids: string[], timeoutMs: number): Promise<number> {
  const start = Date.now();
  for (;;) {
    // Catalog sources are not readable through the user API (404 by design), so check the DB.
    const rows = await ctx.db
      .selectFrom('audio_source')
      .select('status')
      .where('id', 'in', ids)
      .execute();
    if (
      rows.length === ids.length &&
      rows.every((r) => r.status === 'ready' || r.status === 'failed')
    ) {
      return Date.now() - start;
    }
    if (Date.now() - start > timeoutMs) throw new Error('processing timeout');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function run(
  name: string,
  opts: {
    path?: string;
    /** Absolute URL instead of an api path, e.g. a media gateway URL (token in the path). */
    url?: string;
    method?: 'GET' | 'POST';
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  return new Promise<void>((resolve, reject) => {
    autocannon(
      {
        url: opts.url ?? `${API}${opts.path ?? '/'}`,
        method: opts.method ?? 'GET',
        connections: CONNECTIONS,
        duration: DURATION,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
          ...(opts.headers ?? {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      },
      (err, r) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        // A baseline of rejected requests (e.g. 429) is meaningless: fail loudly.
        if (r.non2xx > 0 || r.errors > 0) {
          reject(
            new Error(
              `${name}: ${r.non2xx} non-2xx, ${r.errors} errors — start servers with RATE_LIMIT_ENABLED=false`,
            ),
          );
          return;
        }
        out[name] = {
          rps: Math.round(r.requests.average),
          p50_ms: r.latency.p50,
          p90_ms: r.latency.p90,
          p97_5_ms: r.latency.p97_5,
          p99_ms: r.latency.p99,
          requests: r.requests.total,
        };
        resolve();
      },
    );
  });
}

// ---- setup ----
const op = await token(`bench-op-${Date.now()}`, true);
const user = await token(`bench-user-${Date.now()}`);
const me = await json<{ user_id: string }>('GET', '/v1/me', user);
await json('PUT', `/v1/ops/users/${me.body.user_id}/license-country`, op, {
  license_country: 'KR',
  reason: 'bench',
});
await json('PUT', `/v1/ops/users/${me.body.user_id}/subscription`, op, {
  state: 'active',
  paid_through: new Date(Date.now() + 86_400_000).toISOString(),
  reason: 'bench',
});

const tag = Date.now().toString(36);
const recordings = Array.from({ length: 50 }, (_, i) => ({
  key: `r${i}`,
  title: `Bench Track ${i} ${tag}`,
  artists: ['a'],
  ...(i < 3 ? { audio: 'tone' } : {}),
}));
const cat = await ingestCatalog(
  ctx,
  {
    source: `bench-${tag}`,
    artists: [{ key: 'a', name: `Bench Artist ${tag}` }],
    people: [{ key: 'p', name: `Bench Producer ${tag}` }],
    labels: [{ key: 'l', name: `Bench Label ${tag}` }],
    recordings,
    releases: [
      {
        key: 'rel',
        title: `Bench Album ${tag}`,
        type: 'album',
        label: 'l',
        artists: ['a'],
        tracks: recordings.map((r) => r.key),
      },
    ],
    credits: recordings.map((r) => ({
      subject: r.key,
      contributor: 'p',
      role: 'producer' as const,
    })),
    grants: recordings.slice(0, 3).map((r) => ({
      recording: r.key,
      rights_holder: 'Bench',
      territories: ['KR'],
      uses: ['stream' as const],
      contract_ref: 'BENCH',
    })),
  },
  () => Promise.resolve(wav(30)),
);
const rec0 = cat.ids['r0']!;

// ---- transcoding throughput ----
const clip = wav(60);
const t0 = Date.now();
const uploads = await Promise.all(Array.from({ length: 3 }, () => upload(user, clip)));
const uploadsMs = Date.now() - t0;
const processingMs = await waitReady([...uploads, ...Object.values(cat.sources)], 300_000);
out['transcoding'] = {
  files: uploads.length,
  file_duration_s: 60,
  upload_and_finalize_ms: uploadsMs,
  wall_clock_until_all_ready_ms: processingMs,
  audio_seconds_per_wall_second:
    Math.round(((uploads.length * 60 + 3 * 30) / (processingMs / 1000)) * 10) / 10,
  worker_concurrency: config.worker.concurrency,
};

// ---- storage growth ----
const assets = await ctx.db
  .selectFrom('audio_asset')
  .select(['kind', (eb) => eb.fn.sum<number>('bytes').as('bytes')])
  .where('audio_source_id', 'in', uploads)
  .groupBy('kind')
  .execute();
out['storage_per_minute_of_wav_audio'] = Object.fromEntries(
  assets.map((a) => [a.kind, Math.round(a.bytes / uploads.length)]),
);

// ---- API latency ----
const pl = await json<{ playlist_id: string }>('POST', '/v1/playlists', user, { title: 'bench' });
let etag = '"1"';
for (const id of uploads) {
  const r = await json(
    'POST',
    `/v1/playlists/${pl.body.playlist_id}/items`,
    user,
    { ref_type: 'audio_source', ref_id: id },
    { 'if-match': etag },
  );
  etag = r.headers.get('etag') ?? etag;
}
for (const r of Object.keys(cat.ids)
  .filter((k) => k.startsWith('r') && k !== 'rel')
  .slice(0, 10)) {
  const res = await json(
    'POST',
    `/v1/playlists/${pl.body.playlist_id}/items`,
    user,
    { ref_type: 'recording', ref_id: cat.ids[r] },
    { 'if-match': etag },
  );
  etag = res.headers.get('etag') ?? etag;
}

await run('GET /v1/me', { path: '/v1/me', token: user });
await run('GET /v1/library', { path: '/v1/library', token: user });
await run('GET /v1/playlists/:id (13 mixed items)', {
  path: `/v1/playlists/${pl.body.playlist_id}`,
  token: user,
});
await run('GET /v1/search', {
  path: `/v1/search?q=${encodeURIComponent(`Bench Track ${tag}`)}`,
  token: user,
});
await run('GET /v1/dig connections (credits, 50)', {
  path: `/v1/dig/entities/${cat.ids['p']}/connections?axis=credits&limit=50`,
  token: user,
});
await run('GET /v1/dig axes (recording)', { path: `/v1/dig/entities/${rec0}/axes`, token: user });
await run('POST /v1/playback-sessions (catalog)', {
  path: '/v1/playback-sessions',
  method: 'POST',
  token: user,
  body: { recording_id: rec0, device_id: 'bench-device-1' },
});

// ---- media gateway (R16): token check, session check, object read per request ----
const session = await json<{ manifest_url: string }>('POST', '/v1/playback-sessions', user, {
  recording_id: rec0,
  device_id: 'bench-media',
});
let playlistUrl = session.body.manifest_url;
let segmentUrl: string | null = null;
for (let depth = 0; depth < 3 && !segmentUrl; depth++) {
  const text = await (await fetch(playlistUrl)).text();
  const first = text.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!first) throw new Error(`no media entry in ${playlistUrl}`);
  const next = new URL(first.trim(), playlistUrl).toString();
  if (first.trim().endsWith('.m3u8')) playlistUrl = next;
  else segmentUrl = next;
}
await run('GET media manifest', { url: session.body.manifest_url });
await run('GET media segment', { url: segmentUrl ?? '' });

// ---- query plans ----
const plan = async (name: string, q: ReturnType<typeof sql>) => {
  const r = await sql<{
    'QUERY PLAN': string;
  }>`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q}`.execute(ctx.db);
  const lines = r.rows.map((x) => x['QUERY PLAN']);
  out[`plan: ${name}`] = {
    execution: lines.find((l) => l.startsWith('Execution Time')),
    uses_index: lines.some((l) => /Index|Bitmap/.test(l)),
  };
};
await plan(
  'search tsv',
  sql`SELECT id FROM search_document WHERE visibility = 'public' AND tsv @@ websearch_to_tsquery('simple', ${`bench track ${tag}`}) LIMIT 20`,
);
await plan(
  'credits by contributor',
  sql`SELECT id FROM credit WHERE contributor_entity_id = ${cat.ids['p']!} AND role = 'producer'`,
);
await plan(
  'active grant',
  sql`SELECT id FROM rights_grant WHERE recording_id = ${rec0} AND status = 'active'`,
);

const counts = await sql<{ t: string; n: number }>`
  SELECT 'audio_source' AS t, count(*)::int AS n FROM audio_source
  UNION ALL SELECT 'music_entity', count(*)::int FROM music_entity
  UNION ALL SELECT 'search_document', count(*)::int FROM search_document
  UNION ALL SELECT 'job', count(*)::int FROM job`.execute(ctx.db);
out['dataset'] = Object.fromEntries(counts.rows.map((r) => [r.t, r.n]));
out['settings'] = { duration_s: DURATION, connections: CONNECTIONS };

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
await ctx.db.destroy();
