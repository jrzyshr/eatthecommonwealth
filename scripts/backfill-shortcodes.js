// scripts/backfill-shortcodes.js
// One-time migration: reads municipalities.json, extracts the Instagram
// shortcode from each entry's first Instagram social link, and writes it
// back as a thumbnailShortcode field.
//
// Usage: node scripts/backfill-shortcodes.js

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'municipalities.json');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

// Matches /p/{shortcode}/ and /reel/{shortcode}/ — shortcodes are alphanumeric + underscore + hyphen
const IG_URL_RE = /instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/;

let updated = 0;
let skipped = 0;
let noLink  = 0;

for (const [, entry] of Object.entries(data)) {
  if (!entry.links) { noLink++; continue; }

  // Skip if already set
  if (entry.thumbnailShortcode) { skipped++; continue; }

  // Find first Instagram social link
  const igLink = entry.links.find(l =>
    l.category === 'social' &&
    l.platform && l.platform.toLowerCase() === 'instagram' &&
    l.url
  );

  if (!igLink) { noLink++; continue; }

  const match = IG_URL_RE.exec(igLink.url);
  if (!match) {
    console.warn(`  ⚠  Could not parse shortcode from: ${igLink.url}`);
    noLink++;
    continue;
  }

  entry.thumbnailShortcode = match[1];
  updated++;
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`Done. ${updated} entries updated, ${skipped} already set, ${noLink} with no Instagram link.`);
