// Rasterise the app icon (apps/web/public/icon.svg) into the PNG sizes a PWA
// needs. The SVG stays the favicon / "any" manifest icon; the PNGs exist for
// installers that don't take SVG (Android launcher, iOS home screen, some
// desktop shells).
//
// Outputs (committed, into apps/web/public/):
//   pwa-192x192.png           – manifest icon, purpose "any"
//   pwa-512x512.png           – manifest icon, purpose "any"
//   pwa-maskable-512x512.png  – full-bleed background, knight scaled into the
//                               maskable safe zone (inner 80% circle)
//   apple-touch-icon.png      – 180×180, full-bleed (iOS rounds the corners)
//
// Uses the Playwright chromium that is already a workspace devDependency to
// screenshot the SVG — no extra image deps. Usage:  node scripts/gen-pwa-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'apps/web/public');

const svg = readFileSync(path.join(PUBLIC, 'icon.svg'), 'utf8');

// Full-bleed variant: drop the rounded corners so the gradient reaches every
// pixel (maskable icons and apple-touch icons must not have transparent
// corners — the platform applies its own mask).
const ROUNDED_RECT = '<rect width="512" height="512" rx="120" fill="url(#bg)"/>';
const FULL_RECT = '<rect width="512" height="512" fill="url(#bg)"/>';
if (!svg.includes(ROUNDED_RECT)) throw new Error('icon.svg changed shape — update gen-pwa-icons.mjs');
const fullBleed = svg.replace(ROUNDED_RECT, FULL_RECT);

// Maskable variant: additionally shrink the foreground a touch so the knight
// sits comfortably inside the safe zone (a centred circle of radius 40% of the
// icon width) whatever mask the launcher applies.
const maskable = fullBleed
  .replace(FULL_RECT, `${FULL_RECT}<g transform="translate(256 256) scale(0.88) translate(-256 -256)">`)
  .replace('</svg>', '</g></svg>');

/** Render an SVG string at size×size and return a PNG buffer. */
async function rasterise(page, source, size) {
  await page.setViewportSize({ width: size, height: size });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
  await page.setContent(
    `<style>html,body{margin:0;padding:0}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl}">`,
    { waitUntil: 'load' },
  );
  // omitBackground keeps the rounded corners of the "any" icons transparent.
  return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Pinned browser revision not present — use the preinstalled binary.
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const jobs = [
    ['pwa-192x192.png', svg, 192],
    ['pwa-512x512.png', svg, 512],
    ['pwa-maskable-512x512.png', maskable, 512],
    ['apple-touch-icon.png', fullBleed, 180],
  ];
  for (const [file, source, size] of jobs) {
    const png = await rasterise(page, source, size);
    writeFileSync(path.join(PUBLIC, file), png);
    console.log(`${file}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
  }
} finally {
  await browser.close();
}
