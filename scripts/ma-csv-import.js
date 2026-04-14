/**
 * scripts/ma-csv-import.js
 *
 * Merges data from a CSV (exported from Google Sheets) into data/municipalities.json.
 * Existing municipality records are updated in-place; geographic fields
 * (name, namelsad, county, townType) are never overwritten by this script.
 *
 * Usage:
 *   node scripts/ma-csv-import.js path/to/your-export.csv
 *
 * ── CSV Column Reference ──────────────────────────────────────────────────────
 *
 * REQUIRED:
 *   town               Municipality name (e.g. "Abington") — matched against
 *                      municipalities.json by name. Case-insensitive.
 *
 * VISIT DATA (all optional, leave blank to skip):
 *   restaurant visited  Name of the restaurant
 *   date               Date visited — accepts YYYY-MM-DD or M/D/YYYY
 *   count              Visit number (integer)
 *   meal               Meal or dish eaten (e.g. "Lobster Roll")
 *
 * NOTES / SOCIAL LINKS:
 *   notes              Each non-blank cell is examined:
 *                        • If it starts with "http" and the URL contains
 *                          "facebook.com" (or "fb.com") → stored as a
 *                          Facebook social link.
 *                        • If it starts with "http" for any other domain →
 *                          stored as a generic social link (platform: "Link").
 *                        • Otherwise (plain text) → stored as a
 *                          { category: "note", label: <text>, url: "" }
 *                          entry so text is visible in the admin panel.
 *
 * ── NOTES ────────────────────────────────────────────────────────────────────
 * Running this script more than once against the same municipalities.json is
 * safe: it updates existing entries in-place. Links are fully rebuilt from
 * the CSV on each run.
 *
 * No npm packages required beyond Node.js built-ins.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Args ──────────────────────────────────────────────────────────────────────
const csvPath  = process.argv[2];
const dataFile = path.join(__dirname, '..', 'data', 'municipalities.json');

if (!csvPath) {
  console.error('Usage: node scripts/ma-csv-import.js path/to/your-export.csv');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error('ERROR: CSV file not found:', csvPath);
  process.exit(1);
}
if (!fs.existsSync(dataFile)) {
  console.error('ERROR: data/municipalities.json not found. Run "node scripts/seed.js" first.');
  process.exit(1);
}

// ── Simple CSV parser ─────────────────────────────────────────────────────────
// Handles quoted fields (including embedded commas and newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch   = s[i];
    const next = s[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')           { inQuotes = false; }
      else                           { field += ch; }
    } else {
      if      (ch === '"')  { inQuotes = true; }
      else if (ch === ',')  { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else                  { field += ch; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length < 2) return [];

  // First row is the header
  const headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  return rows.slice(1).filter(function (r) {
    return r.some(function (c) { return c.trim() !== ''; });
  }).map(function (r) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

// ── Date normalisation → YYYY-MM-DD ──────────────────────────────────────────
function normaliseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const mdy4 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy4) {
    return mdy4[3] + '-' + mdy4[1].padStart(2, '0') + '-' + mdy4[2].padStart(2, '0');
  }
  console.warn('  WARNING: unrecognised date format "' + str + '" — stored as-is');
  return str;
}

// ── Build links from notes cell ───────────────────────────────────────────────
function buildLinksFromNotes(notesValue, restaurantName) {
  const links = [];
  if (!notesValue) return links;

  // Split on whitespace or comma-separated URLs (Google Sheets may export as a
  // single cell with multiple values if the column had multiple lines)
  const parts = notesValue.split(/[\s,]+/).filter(Boolean);

  // Reassemble by "joining" consecutive non-URL fragments as a single note
  const segments = [];
  let textBuffer = [];
  for (const part of parts) {
    if (part.startsWith('http://') || part.startsWith('https://')) {
      if (textBuffer.length > 0) {
        segments.push({ type: 'text', value: textBuffer.join(' ') });
        textBuffer = [];
      }
      segments.push({ type: 'url', value: part });
    } else {
      textBuffer.push(part);
    }
  }
  if (textBuffer.length > 0) {
    segments.push({ type: 'text', value: textBuffer.join(' ') });
  }

  for (const seg of segments) {
    if (seg.type === 'url') {
      const url = seg.value;
      const isFacebook = /facebook\.com|fb\.com/i.test(url);
      if (isFacebook) {
        links.push({
          category: 'social',
          platform: 'Facebook',
          label:    restaurantName || 'Facebook Post',
          url:      url
        });
      } else {
        // Unknown URL domain — store as generic social link for admin review
        links.push({
          category: 'social',
          platform: 'Link',
          label:    restaurantName || 'Social Post',
          url:      url
        });
      }
    } else if (seg.type === 'text' && seg.value.trim()) {
      // Plain text note — store so it's visible in the admin panel
      links.push({
        category: 'note',
        label:    seg.value.trim(),
        url:      ''
      });
    }
  }

  return links;
}

// ── Build name → geoid lookup (case-insensitive) ─────────────────────────────
function buildNameIndex(data) {
  const index = {};
  for (const [geoid, entry] of Object.entries(data)) {
    const key = (entry.name || '').toLowerCase();
    if (!index[key]) index[key] = [];
    index[key].push(geoid);

    // MA has municipalities whose official Census name ends with " Town" even
    // though their townType is "city" (e.g. "Barnstable Town").  The CSV
    // typically uses only the base name ("Barnstable"), so index that too.
    if (entry.townType === 'city' && key.endsWith(' town')) {
      const base = key.slice(0, -5);          // strip " town"
      if (!index[base]) index[base] = [];
      index[base].push(geoid);
    }
  }
  return index;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const raw  = fs.readFileSync(dataFile, 'utf8');
const data = JSON.parse(raw);
const nameIndex = buildNameIndex(data);

const csvText = fs.readFileSync(csvPath, 'utf8');
const rows    = parseCsv(csvText);

let updated  = 0;
let skipped  = 0;
let warnings = 0;

for (const row of rows) {
  // ── Resolve GEOID by town name ──────────────────────────────────────────
  const nameKey = (row['town'] || '').toLowerCase().trim();
  if (!nameKey) {
    console.warn('  SKIP: row has no "town" value');
    skipped++; continue;
  }

  const matches = nameIndex[nameKey] || [];

  if (matches.length === 0) {
    console.warn('  SKIP: no municipality found for town "' + row['town'] + '"');
    skipped++; warnings++; continue;
  }

  // MA has some duplicate town names across counties; add a "county" column to
  // disambiguate if needed.
  let geoid;
  if (matches.length > 1) {
    const countyFilter = (row['county'] || '').toLowerCase().trim();
    if (countyFilter) {
      const filtered = matches.filter(function (g) {
        return (data[g].county || '').toLowerCase() === countyFilter;
      });
      if (filtered.length === 1) {
        geoid = filtered[0];
      } else {
        console.warn('  SKIP: "' + row['town'] + '" matches ' + matches.length + ' entries; add a "county" column to the CSV to disambiguate');
        skipped++; warnings++; continue;
      }
    } else {
      console.warn('  SKIP: "' + row['town'] + '" matches ' + matches.length + ' entries; add a "county" column to the CSV to disambiguate');
      skipped++; warnings++; continue;
    }
  } else {
    geoid = matches[0];
  }

  const entry = data[geoid];

  // ── Visit status ──────────────────────────────────────────────────────────
  // If a restaurant name is present, default to "visited" unless already set.
  const hasVisitData = (row['restaurant visited'] || row['date'] || row['count'] || row['meal']);
  if (hasVisitData && (!entry.status || entry.status === 'unvisited')) {
    entry.status = 'visited';
  }

  // ── Restaurant name ───────────────────────────────────────────────────────
  const restName = (row['restaurant visited'] || '').trim();
  if (restName) entry.restaurantName = restName;

  // ── Meal / dish ───────────────────────────────────────────────────────────
  const meal = (row['meal'] || '').trim();
  if (meal) entry.mealName = meal;

  // ── Date visited ──────────────────────────────────────────────────────────
  const dateVal = (row['date'] || '').trim();
  if (dateVal) entry.dateVisited = normaliseDate(dateVal);

  // ── Visit number (count) ─────────────────────────────────────────────────
  const countVal = (row['count'] || '').trim();
  if (countVal !== '') {
    const n = parseInt(countVal, 10);
    if (!isNaN(n)) entry.visitNumber = n;
  }

  // ── Notes / social links ──────────────────────────────────────────────────
  const notes = (row['notes'] || '').trim();
  if (notes) {
    const newLinks = buildLinksFromNotes(notes, entry.restaurantName);
    if (newLinks.length > 0) {
      // Merge: keep any existing links whose URLs are not in the new set
      const newUrls  = new Set(newLinks.filter(l => l.url).map(l => l.url));
      const orphaned = (entry.links || []).filter(function (l) {
        return l.url && !newUrls.has(l.url);
      });
      if (orphaned.length > 0) {
        console.warn('  WARNING: ' + entry.name + ' — ' + orphaned.length +
          ' existing link(s) not in CSV preserved (review in admin panel):');
        orphaned.forEach(function (l) {
          console.warn('    [' + l.category + '] "' + (l.label || '') + '" → ' + l.url);
        });
        warnings += orphaned.length;
      }
      entry.links = newLinks.concat(orphaned);
    }
  }

  updated++;
}

fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');

console.log('\nImport complete.');
console.log('  Updated  : ' + updated);
console.log('  Skipped  : ' + skipped);
if (warnings > 0) {
  console.log('  Warnings : ' + warnings + ' (see above)');
}
