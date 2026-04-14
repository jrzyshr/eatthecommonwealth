// scripts/fetch-thumbnails.js
// Downloads and resizes thumbnail images for all municipalities that have a
// thumbnailShortcode, using CDN URLs from the PostFox Instagram export JSON.
// Already-downloaded shortcodes are skipped (idempotent).
//
// Usage: node scripts/fetch-thumbnails.js
// Requires: npm install sharp

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const sharp = require('sharp');

const MUNICIPALITIES_PATH = path.join(__dirname, '..', 'data', 'municipalities.json');
const IG_EXPORT_GLOB      = path.join(__dirname, '..', 'data');
const THUMBNAILS_DIR      = path.join(__dirname, '..', 'images', 'thumbnails');
const THUMB_WIDTH         = 320;
const WEBP_QUALITY        = 80;

// ── Load the PostFox export ──────────────────────────────────────────────────
// Supports any file matching data/IGPOSTS_USERS_*.json
const exportFiles = fs.readdirSync(IG_EXPORT_GLOB)
  .filter(f => f.startsWith('IGPOSTS_USERS_') && f.endsWith('.json'))
  .map(f => path.join(IG_EXPORT_GLOB, f));

if (exportFiles.length === 0) {
  console.error('No IGPOSTS_USERS_*.json file found in data/');
  process.exit(1);
}

// If multiple exports exist, use the most recently modified one
exportFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const exportPath = exportFiles[0];
console.log(`Using export: ${path.basename(exportPath)}`);

const igPosts = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

// Build shortcode → thumbnail URL lookup
const shortcodeMap = {};
for (const post of igPosts) {
  const shortcode = post['Shortcode'];
  const thumbUrl  = post['Thumbnail URL'];
  if (shortcode && thumbUrl) {
    shortcodeMap[shortcode] = thumbUrl;
  }
}
console.log(`Export contains ${Object.keys(shortcodeMap).length} shortcode(s).`);

// ── Collect shortcodes to process ────────────────────────────────────────────
const municipalities = JSON.parse(fs.readFileSync(MUNICIPALITIES_PATH, 'utf8'));
const toFetch = [];

for (const entry of Object.values(municipalities)) {
  if (!entry.thumbnailShortcode) continue;
  const sc  = entry.thumbnailShortcode;
  const out = path.join(THUMBNAILS_DIR, sc + '.webp');

  if (fs.existsSync(out)) continue; // already downloaded

  if (!shortcodeMap[sc]) {
    console.warn(`  ⚠  No CDN URL in export for shortcode: ${sc} (${entry.name})`);
    continue;
  }

  toFetch.push({ shortcode: sc, name: entry.name, url: shortcodeMap[sc], outPath: out });
}

if (toFetch.length === 0) {
  console.log('No new thumbnails to fetch.');
  process.exit(0);
}

fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
console.log(`\nFetching ${toFetch.length} thumbnail(s) into images/thumbnails/...\n`);

// ── Download helper (follows one redirect) ───────────────────────────────────
function download(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'EJC-Thumbnail-Fetcher/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
        return download(res.headers.location, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // drain to free socket
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function processAll() {
  let success = 0;
  let failed  = 0;

  for (const { shortcode, name, url, outPath } of toFetch) {
    try {
      const buf = await download(url);
      await sharp(buf)
        .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(outPath);
      console.log(`  ✓  ${shortcode}  (${name})`);
      success++;
    } catch (err) {
      console.error(`  ✗  ${shortcode}  (${name}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} downloaded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

processAll();
