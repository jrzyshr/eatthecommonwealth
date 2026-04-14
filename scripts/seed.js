/**
 * scripts/seed.js
 *
 * One-time script: reads ma_municipalities.geojson and generates
 * data/municipalities.json — the static data file used by the map.
 *
 * Each entry is keyed by GEOID and initialised with all schema fields:
 *   - name, namelsad, county, townType
 *   - status, visitNumber, restaurantName, mealName, dateVisited
 *   - thumbnailShortcode, links
 *
 * Usage:
 *   node scripts/seed.js
 *
 * Re-running this resets all visit data back to defaults.
 * To preserve existing data, edit municipalities.json directly.
 *
 * No npm packages required — uses only Node.js built-ins.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '..', 'data', 'ma_municipalities.geojson');
const outputPath  = path.join(__dirname, '..', 'data', 'municipalities.json');

if (!fs.existsSync(geojsonPath)) {
  console.error('ERROR: data/ma_municipalities.geojson not found.');
  process.exit(1);
}

// Derive townType from the last word of namelsad (e.g. "Abington town" → "town")
function deriveTownType(namelsad) {
  if (!namelsad) return '';
  const parts = namelsad.trim().split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

const municipalities = {};
for (const feature of geojson.features) {
  const props = feature.properties;
  municipalities[props.GEOID] = {
    name:               props.name,
    namelsad:           props.namelsad,
    county:             props.county,
    townType:           deriveTownType(props.namelsad),
    status:             'unvisited',
    visitNumber:        null,
    restaurantName:     null,
    mealName:           null,
    dateVisited:        null,
    thumbnailShortcode: null,
    links:              []
  };
}

fs.writeFileSync(outputPath, JSON.stringify(municipalities, null, 2), 'utf8');
console.log('Done. Generated data/municipalities.json with ' + Object.keys(municipalities).length + ' entries.');
