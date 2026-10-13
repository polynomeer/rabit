// Renders the PNG icons in public/ from the SVG sources (brand guide §5: the symbol
// alone on Ink). Re-run whenever the symbol changes (brand.tsx, favicon.svg, icons/*.svg):
//   pnpm --filter @rabit/web icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const jobs = [
  ['public/favicon.svg', 32, 'public/favicon-32.png', true],
  ['icons/app-icon.svg', 180, 'public/apple-touch-icon.png', false],
  ['icons/app-icon.svg', 192, 'public/icon-192.png', false],
  ['icons/app-icon.svg', 512, 'public/icon-512.png', false],
  ['icons/app-icon-maskable.svg', 512, 'public/icon-maskable-512.png', false],
];

const browser = await chromium.launch();
for (const [src, size, out, transparent] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(at(src), 'utf8').replace(
    '<svg ',
    `<svg width="${size}" height="${size}" `,
  );
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  await page.screenshot({
    path: at(out),
    omitBackground: transparent,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
}
await browser.close();
