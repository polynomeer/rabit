// WCAG 2.1 contrast audit of the design tokens (ADR-0022, OQ-BRD-03).
// Reads the dark tokens (:root) and the light ones (:root[data-theme='light']) from
// src/styles.css and prints every text/background and control-boundary pair.
// Run: node apps/web/scripts/contrast.mjs   (exit code 1 when a pair fails)
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const say = (line) => process.stdout.write(`${line}\n`);

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
// Hex values and var(--other) references; references resolve against the dark base.
const tokens = (text) =>
  Object.fromEntries(
    [...text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|var\(--[\w-]+\));/gi)].map((m) => [m[1], m[2]]),
  );
const resolve = (map, base) =>
  Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, v.startsWith('var(') ? base[v.slice(6, -1)] : v]),
  );
const darkRaw = tokens(block(':root'));
const dark = resolve(darkRaw, darkRaw);
const light = { ...dark, ...resolve(tokens(block(":root[data-theme='light']")), dark) };

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((x) => channel(parseInt(x, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const surfaces = ['bg', 'surface', 'surface-2'];
const checks = [
  ...['fg', 'muted', 'accent', 'ok', 'warn'].map((t) => [t, 4.5, 'text']),
  ['control-line', 3, 'field boundary (1.4.11)'],
];
let failed = 0;
for (const [scheme, t] of [
  ['dark', dark],
  ['light', light],
]) {
  for (const [token, need, kind] of checks)
    for (const bg of surfaces) {
      const r = ratio(t[token], t[bg]);
      if (r < need) failed++;
      say(
        `${scheme.padEnd(5)} --${token.padEnd(12)} on --${bg.padEnd(9)} ${r.toFixed(2).padStart(5)} ` +
          `(need ${need}, ${kind}) ${r >= need ? 'pass' : 'FAIL'}`,
      );
    }
}
const filled = ratio('#ffffff', dark.purple);
if (filled < 4.5) failed++;
say(
  `white on --purple (filled buttons) ${filled.toFixed(2)} (need 4.5) ${filled >= 4.5 ? 'pass' : 'FAIL'}`,
);
process.exitCode = failed > 0 ? 1 : 0;
