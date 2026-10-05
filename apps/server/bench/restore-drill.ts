/**
 * Backup/restore drill (R9, runbooks#backup-restore). Uses its own databases
 * (`rabit_drill`, `rabit_drill_restored`) on the local Postgres container, so dev
 * data is untouched, and prints a JSON report with timings.
 *
 *   pnpm infra:up && pnpm --filter @rabit/server drill:restore
 *
 * Steps: seed a catalog with audio → back up (pg_dump) → remove one recording's
 * audio after the backup → restore into a new database → show that the removed
 * audio came back → reconcile → show it is gone again and the rest still plays.
 * Timings are for this machine and this data size only, not a production RTO.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { closeContext, createContext, type AppContext } from '../src/app/context.js';
import { allModules } from '../src/app/registry.js';
import { buildWorker } from '../src/app/worker.js';
import { markDeleting } from '../src/modules/audio/index.js';
import { ingestCatalog } from '../src/modules/catalog/index.js';
import { reconcileAfterRestore } from '../src/modules/ops/restore-reconcile.js';
import { loadConfig } from '../src/platform/config.js';
import { migrateToLatest } from '../src/platform/db/migrator.js';
import { createLogger } from '../src/platform/logger.js';
import type { Bucket } from '../src/platform/storage/blob-store.js';

const SOURCE_DB = 'rabit_drill';
const RESTORED_DB = 'rabit_drill_restored';
const base = new URL(process.env['DATABASE_URL'] ?? 'postgres://rabit:rabit@127.0.0.1:55440/rabit');
const urlFor = (db: string) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();
const compose = (args: string[], input?: Buffer) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
    input,
    maxBuffer: 1 << 30,
  });
const psql = (statement: string) =>
  compose([
    'psql',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    base.username,
    '-d',
    'postgres',
    '-c',
    statement,
  ]);

function recreate(db: string) {
  psql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  psql(`CREATE DATABASE ${db}`);
}

function contextFor(db: string): AppContext {
  process.env['DATABASE_URL'] = urlFor(db);
  return createContext(loadConfig(), createLogger({ level: 'warn', name: 'restore-drill' }));
}

const timed = async <T>(fn: () => T | Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t)];
};

function tone(seconds: number, hz: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'rabit-drill-'));
  const f = join(dir, 'a.wav');
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${hz}:duration=${seconds}`,
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    f,
  ]);
  const b = readFileSync(f);
  rmSync(dir, { recursive: true, force: true });
  return b;
}

async function audioOf(ctx: AppContext, recordingId: string) {
  const r = await ctx.db
    .selectFrom('recording as r')
    .leftJoin('audio_source as s', 's.id', 'r.catalog_audio_source_id')
    .select(['r.catalog_audio_source_id as source', 's.status'])
    .where('r.id', '=', recordingId)
    .executeTakeFirstOrThrow();
  return r;
}

async function originalExists(ctx: AppContext, sourceId: string): Promise<boolean> {
  const a = await ctx.db
    .selectFrom('audio_asset')
    .select(['bucket', 'object_key'])
    .where('audio_source_id', '=', sourceId)
    .where('kind', '=', 'original')
    .executeTakeFirst();
  return a ? (await ctx.blobs.head(a.bucket as Bucket, a.object_key)) !== null : false;
}

const report: Record<string, unknown> = { machine: { node: process.version } };
const work = mkdtempSync(join(tmpdir(), 'rabit-drill-dump-'));
const dumpFile = join(work, 'rabit.dump');

// 1. A database with a small catalog whose audio is processed.
recreate(SOURCE_DB);
let ctx = contextFor(SOURCE_DB);
await migrateToLatest(ctx.db);
const tag = Date.now().toString(36);
const cat = await ingestCatalog(
  ctx,
  {
    source: `drill-${tag}`,
    artists: [{ key: 'a', name: `Drill Artist ${tag}` }],
    people: [],
    labels: [],
    recordings: [
      { key: 'removed', title: `Removed After Backup ${tag}`, artists: ['a'], audio: 'x' },
      { key: 'kept', title: `Kept ${tag}`, artists: ['a'], audio: 'y' },
    ],
    releases: [],
    credits: [],
    relations: [],
  },
  (ref) => Promise.resolve(ref === 'x' ? tone(4, 330) : tone(4, 550)),
);
await buildWorker(ctx, allModules()).drain();
const removed = cat.ids['removed']!;
const kept = cat.ids['kept']!;

// 2. Backup.
const [, backupMs] = await timed(() => {
  writeFileSync(dumpFile, compose(['pg_dump', '-U', base.username, '-Fc', SOURCE_DB]));
});
report['backup'] = { ms: backupMs, bytes: statSync(dumpFile).size };

// 3. After the backup, an operator removes one recording's audio (R10) and the
//    deletion job removes its objects from storage.
const removedSource = (await audioOf(ctx, removed)).source!;
await ctx.db.transaction().execute(async (tx) => {
  const s = await tx
    .selectFrom('audio_source')
    .select('workspace_id')
    .where('id', '=', removedSource)
    .executeTakeFirstOrThrow();
  await markDeleting(tx, removedSource, s.workspace_id, new Date(), null);
  await tx
    .updateTable('recording')
    .set({ catalog_audio_source_id: null })
    .where('id', '=', removed)
    .execute();
});
await buildWorker(ctx, allModules()).drain();
await closeContext(ctx);

// 4. Restore into a new database.
recreate(RESTORED_DB);
const [, restoreMs] = await timed(() =>
  compose(
    ['pg_restore', '-U', base.username, '-d', RESTORED_DB, '--no-owner'],
    readFileSync(dumpFile),
  ),
);
ctx = contextFor(RESTORED_DB);
const [, migrateMs] = await timed(() => migrateToLatest(ctx.db));
const resurrected = await audioOf(ctx, removed);

// 5. Reconcile, then let the worker finish the queued deletions.
const [rec, reconcileMs] = await timed(() => reconcileAfterRestore(ctx));
const [, drainMs] = await timed(() => buildWorker(ctx, allModules()).drain());
const after = await audioOf(ctx, removed);
const keptAfter = await audioOf(ctx, kept);
const keptPlayable = keptAfter.status === 'ready' && (await originalExists(ctx, keptAfter.source!));
const counts = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audio_source`.execute(
  ctx.db,
);
await closeContext(ctx);

report['restore'] = {
  pg_restore_ms: restoreMs,
  migrate_ms: migrateMs,
  reconcile_ms: reconcileMs,
  drain_ms: drainMs,
};
report['rto_measured_ms'] = restoreMs + migrateMs + reconcileMs + drainMs;
report['checks'] = {
  removed_audio_came_back_with_the_restore: resurrected.source === removedSource,
  removed_audio_gone_after_reconcile: after.source === null,
  orphans_found: rec.orphanedSources.length,
  kept_recording_still_playable: keptPlayable,
  sources_in_restored_db: counts.rows[0]?.n,
};
report['ok'] = after.source === null && keptPlayable && resurrected.source === removedSource;

psql(`DROP DATABASE IF EXISTS ${SOURCE_DB} WITH (FORCE)`);
psql(`DROP DATABASE IF EXISTS ${RESTORED_DB} WITH (FORCE)`);
rmSync(work, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report['ok'] !== true) process.exitCode = 1;
