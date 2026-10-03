// Renders the app icon into the PNG/ICO sizes Tauri needs for bundling.
//
// Tauri wants a .ico (Windows) and .png (other platforms). The source of truth
// stays icon.svg; this only derives the raster files, so the icon is never
// edited in two places.
//
//   node tools/app-icon.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Google Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('chrome not found; cannot render icons');
  process.exit(1);
}

const svg = readFileSync('icon.svg', 'utf8');
mkdirSync('build', { recursive: true });

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:512px;height:512px}
</style></head><body>${svg}</body></html>`;
const htmlPath = 'build/icon.html';
writeFileSync(htmlPath, html);

const SIZES = [32, 128, 256];
const htmlUrl = `file:///${resolve(htmlPath).replace(/\\/g, '/')}`;

for (const size of SIZES) {
  const out = resolve(`build/icon-${size}.png`);
  // The page lays the icon out at 512px, so the window is always 512 and only
  // the device scale factor decides the output size. Setting both would make
  // chrome multiply them together (a 32px window at 1/16 scale gave a 2px png).
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${out}`,
    '--window-size=512,512',
    '--default-background-color=00000000',
    `--force-device-scale-factor=${size / 512}`,
    htmlUrl,
  ], { stdio: 'ignore' });

  if (!existsSync(out)) throw new Error(`chrome wrote no output for ${size}px`);

  // Confirm the raster really is the size that was asked for.
  const head = readFileSync(out);
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  if (w !== size || h !== size) {
    throw new Error(`icon-${size}.png came out ${w}x${h}, expected ${size}x${size}`);
  }
  console.log(`icon-${size}.png (${w}x${h})`);
}

rmSync(htmlPath, { force: true });
console.log('run: cargo tauri icon build/icon-256.png  (generates .ico + platform icons)');