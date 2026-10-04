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
    const offenders = files.filter((f) => /\bconsole\.(log|info|warn|error)\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
