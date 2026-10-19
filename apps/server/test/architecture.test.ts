import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const importRe = /from\s+'([^']+)'/g;

describe('architecture (ADR-0001, domain-boundaries §2)', () => {
  const files = walk(SRC);

  it('modules import other modules only through their index', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      const own = /^modules\/([^/]+)\//.exec(rel)?.[1];
      if (!own) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(importRe)) {
        const spec = m[1]!;
        if (!spec.startsWith('.')) continue;
        const target = relative(SRC, resolve(dirname(file), spec));
        const other = /^modules\/([^/]+)\/(.+)$/.exec(target);
        if (other && other[1] !== own && other[2] !== 'index.js') {
          violations.push(`${rel} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('platform code never depends on modules or app wiring', () => {
    const violations = files
      .filter((f) => relative(SRC, f).startsWith('platform/'))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(importRe)]
          .map((m) => m[1]!)
          .filter((s) => s.includes('/modules/') || s.includes('/app/'))
          .map((s) => `${relative(SRC, f)} -> ${s}`),
      );
    expect(violations).toEqual([]);
  });

  it('never uses console logging in server code', () => {
    const offenders = files.filter((f) =>
      /\bconsole\.(log|info|warn|error)\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
  /**
   * Table ownership (domain-boundaries §1–2): a module writes only its own tables.
   * Reads of another module's tables are allowed only as the read models listed
   * below; a new one is a design decision, made by adding it here.
   */
  const OWNS: Record<string, string> = {
    identity: 'app_user workspace membership',
    audio: 'upload_session audio_object audio_version audio_source audio_asset audio_log',
    catalog:
      'music_entity recording recording_artist release release_artist release_track credit music_relation rights_grant',
    entitlement: 'subscription entitlement',
    playback: 'playback_session listening_event recording_popularity',
    library: 'library_item playlist playlist_item export_request',
    collection: 'physical_item',
    dig: 'dig_session dig_trail_node blind_dig blind_dig_item',
    search: 'search_document',
    integrity: 'provenance_claim integrity_signal report',
    commerce:
      'offer purchase_order payment_refund payment_event ledger_journal ledger_line mock_payment mock_card app_store_account',
    ops: 'job outbox_event audit_log idempotency_record rate_limit_counter',
  };
  const owner = new Map(
    Object.entries(OWNS).flatMap(([m, ts]) => ts.split(' ').map((t) => [t, m] as const)),
  );
  /** Writes into another module's tables, each with its reason. */
  const ALLOWED_WRITES: Record<string, string> = {
    // Provenance claims arrive in the catalog manifest; integrity depends on catalog,
    // so catalog cannot call into integrity without a cycle.
    'catalog -> provenance_claim': 'catalog ingest records the manifest provenance claims',
  };
  /** Read models: module -> owner module whose tables it may read. */
  const ALLOWED_READS = new Set([
    'audio -> identity',
    'catalog -> audio',
    'catalog -> identity',
    'collection -> catalog',
    'commerce -> catalog',
    'commerce -> entitlement',
    'commerce -> identity',
    'dig -> audio',
    'dig -> catalog',
    'dig -> playback',
    'entitlement -> catalog',
    'entitlement -> identity',
    'integrity -> catalog',
    'library -> audio',
    'library -> catalog',
    'library -> identity',
    'ops -> audio',
    'ops -> identity',
    'playback -> audio',
    'search -> audio',
    'search -> catalog',
  ]);

  it('modules write only their own tables and read others only through listed read models', () => {
    const writes =
      /\b(insertInto|updateTable|deleteFrom)\(\s*'([a-z_]+)'|\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)\b/g;
    const reads = /\b(selectFrom|innerJoin|leftJoin)\(\s*'([a-z_]+)/g;
    const badWrites: string[] = [];
    const badReads: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      const own = /^modules\/([^/]+)\//.exec(rel)?.[1];
      if (!own) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(writes)) {
        const table = m[2] ?? m[3]!;
        const o = owner.get(table);
        if (o && o !== own && !ALLOWED_WRITES[`${own} -> ${table}`]) {
          badWrites.push(`${rel} writes ${table} (owned by ${o})`);
        }
      }
      for (const m of src.matchAll(reads)) {
        const o = owner.get(m[2]!);
        if (o && o !== own && !ALLOWED_READS.has(`${own} -> ${o}`)) {
          badReads.push(`${rel} reads ${m[2]} (owned by ${o})`);
        }
      }
    }
    expect(badWrites).toEqual([]);
    expect(badReads).toEqual([]);
  });

  it('every table has exactly one owning module', () => {
    const tables = Object.values(OWNS).flatMap((ts) => ts.split(' '));
    expect(new Set(tables).size).toBe(tables.length);
  });
});
