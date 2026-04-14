/**
 * scripts/convert-shapefile.js
 *
 * One-time script: converts the Census TIGER county-subdivision shapefile for
 * Massachusetts into the GeoJSON format expected by the map and seed scripts.
 *
 * Input : data/cousub_shp/tl_2023_25_cousub.shp
 * Output: data/ma_municipalities.geojson
 *
 * Usage: node scripts/convert-shapefile.js
 */

'use strict';

const shapefile = require('shapefile');
const fs        = require('fs');
const path      = require('path');

// MA county FIPS → county name (all 14 Massachusetts counties)
const COUNTY_MAP = {
  '001': 'Barnstable',
  '003': 'Berkshire',
  '005': 'Bristol',
  '007': 'Dukes',
  '009': 'Essex',
  '011': 'Franklin',
  '013': 'Hampden',
  '015': 'Hampshire',
  '017': 'Middlesex',
  '019': 'Nantucket',
  '021': 'Norfolk',
  '023': 'Plymouth',
  '025': 'Suffolk',
  '027': 'Worcester'
};

const shpPath = path.join(__dirname, '..', 'data', 'cousub_shp', 'tl_2023_25_cousub.shp');
const outPath = path.join(__dirname, '..', 'data', 'ma_municipalities.geojson');

(async function () {
  const features = [];
  const source = await shapefile.open(shpPath);

  while (true) {
    const result = await source.read();
    if (result.done) break;

    const p = result.value.properties;

    // Exclude Census placeholder entries ("County subdivisions not defined")
    // Note: FUNCSTAT=F includes real MA cities (Boston, Worcester, etc.) that are
    // coextensive with incorporated places — keep all except placeholder names.
    if (!p.NAME || p.NAME.toLowerCase().includes('not defined')) continue;

    const county = COUNTY_MAP[p.COUNTYFP] || p.COUNTYFP;

    features.push({
      type: 'Feature',
      properties: {
        GEOID:    p.GEOID,
        name:     p.NAME,
        namelsad: p.NAMELSAD,
        county:   county
      },
      geometry: result.value.geometry
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    features: features
  };

  fs.writeFileSync(outPath, JSON.stringify(geojson), 'utf8');
  console.log('Done. Wrote ' + features.length + ' features to data/ma_municipalities.geojson');
})().catch(function (err) {
  console.error('Error:', err);
  process.exit(1);
});
