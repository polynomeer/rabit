// Bundle-size budget (commercial quality plan CQ-WEB-1): gzip sizes of the built
// web app must stay under these limits, so page load (LCP, ADR-0027) does not drift.
// Runs after `vite build`; raising a limit is a reviewed change in this file.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import process from 'node:process';

const say = (line) => process.stdout.write(`${line}\n`);
const complain = (line) => process.stderr.write(`${line}\n`);

const KB = 1024;
/** What the first page load needs: the entry script and the stylesheet. */
const ENTRY_JS = 140 * KB;
const CSS = 40 * KB;
/** Any chunk loaded later (hls.js, the operator console). */
const LAZY_CHUNK = 200 * KB;

const dist = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(join(dist, 'index.html'))) {
  if (process.env.CI) {
    complain('bundle budget: apps/web/dist is missing; run the build first');
    process.exit(1);
  }
  say('bundle budget: no build in apps/web/dist, skipped (run pnpm build first)');
  process.exit(0);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = /<script[^>]+src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
const gz = (f) => gzipSync(readFileSync(join(dist, 'assets', f))).length;
const failures = [];
const check = (file, size, limit) => {
  const line = `${file}: ${(size / KB).toFixed(1)} kB gzip (limit ${limit / KB} kB)`;
  if (size > limit) failures.push(line);
  else say(`ok  ${line}`);
};

for (const f of readdirSync(join(dist, 'assets'))) {
  if (f.endsWith('.js')) check(f, gz(f), f === entry ? ENTRY_JS : LAZY_CHUNK);
  else if (f.endsWith('.css')) check(f, gz(f), CSS);
}
if (!entry) failures.push('index.html names no entry script');
if (failures.length > 0) {
  for (const f of failures) complain(`over budget  ${f}`);
  process.exit(1);
}
