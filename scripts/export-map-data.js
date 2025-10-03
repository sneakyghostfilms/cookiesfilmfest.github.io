#!/usr/bin/env node

import { festivals } from '../src/data/festivals.js';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCATIONS_FILE = join(__dirname, '../src/data/festival-locations.json');
const OUTPUT_FILE = join(__dirname, '../festival-map.csv');

async function loadLocations() {
  try {
    const data = await readFile(LOCATIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ No locations file found. Run `npm run geocode` first.');
      process.exit(1);
    }
    throw error;
  }
}

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function applyJitter(festivals, locations) {
  // Group festivals by their base coordinates
  const coordGroups = new Map();

  festivals.forEach(festival => {
    const location = locations[festival.name];
    if (!location) return;

    const key = `${location.lat},${location.lng}`;
    if (!coordGroups.has(key)) {
      coordGroups.set(key, []);
    }
    coordGroups.get(key).push({ festival, location });
  });

  // Apply jitter to groups with multiple festivals
  const jitteredLocations = {};

  coordGroups.forEach((group, coordKey) => {
    if (group.length === 1) {
      // Single festival at this location - no jitter needed
      jitteredLocations[group[0].festival.name] = group[0].location;
    } else {
      // Multiple festivals - arrange in circle
      const baseLocation = group[0].location;
      const radius = group.length <= 4 ? 0.01 : 0.015; // ~1km or ~1.5km

      group.forEach((item, index) => {
        const angle = (index * 2 * Math.PI) / group.length;
        const latOffset = radius * Math.cos(angle);
        const lngOffset = radius * Math.sin(angle);

        jitteredLocations[item.festival.name] = {
          lat: baseLocation.lat + latOffset,
          lng: baseLocation.lng + lngOffset,
          city: baseLocation.city
        };
      });
    }
  });

  return jitteredLocations;
}

function createCSVRow(festival, location) {
  const descriptionLines = [
    `City: ${festival.city}`,
    `Event Month: ${festival.month}`
  ];

  // Only add genre if it's not null
  if (festival.genre) {
    descriptionLines.push(`Genre: ${festival.genre}`);
  }

  const description = descriptionLines.join('\n');

  return [
    escapeCSV(festival.name),
    escapeCSV(location.lat),
    escapeCSV(location.lng),
    escapeCSV(description),
    escapeCSV(festival.website),
    escapeCSV(festival.submissionUrl || ''),
  ].join(',');
}

async function main() {
  console.log('📊 Festival Map Data Export');
  console.log('━'.repeat(50));

  const locations = await loadLocations();

  console.log(`Total festivals: ${festivals.length}`);
  console.log(`Total locations: ${Object.keys(locations).length}`);

  // Find festivals with coordinates
  const withCoords = festivals.filter(f => locations[f.name]);
  const missing = festivals.filter(f => !locations[f.name]);

  console.log(`With coordinates: ${withCoords.length}`);
  if (missing.length > 0) {
    console.log(`Missing coordinates: ${missing.length}`);
    console.log('  Missing festivals:');
    missing.forEach(f => console.log(`    - ${f.name}`));
    console.log('\n⚠️  Run `npm run geocode` to fetch missing coordinates\n');
  }
  console.log('━'.repeat(50));

  if (withCoords.length === 0) {
    console.error('❌ No festivals with coordinates. Run `npm run geocode` first.');
    process.exit(1);
  }

  // Apply jitter to prevent overlapping markers
  console.log('\n🎯 Applying coordinate jitter to prevent marker overlap...');
  const jitteredLocations = applyJitter(withCoords, locations);

  // Count cities with multiple festivals
  const coordGroups = new Map();
  withCoords.forEach(festival => {
    const loc = locations[festival.name];
    const key = `${loc.lat},${loc.lng}`;
    coordGroups.set(key, (coordGroups.get(key) || 0) + 1);
  });
  const citiesWithMultiple = Array.from(coordGroups.values()).filter(count => count > 1).length;
  console.log(`   Jittered ${citiesWithMultiple} location(s) with multiple festivals`);

  // Create CSV content
  const headers = ['Name', 'Latitude', 'Longitude', 'Description', 'Website', 'Submission'];
  const rows = withCoords.map(festival =>
    createCSVRow(festival, jitteredLocations[festival.name])
  );

  const csv = [headers.join(','), ...rows].join('\n');

  // Write to file
  await writeFile(OUTPUT_FILE, csv, 'utf-8');

  console.log(`✅ Exported ${withCoords.length} festivals to: festival-map.csv`);
  console.log('\n📍 To import into Google My Maps:');
  console.log('   1. Go to https://www.google.com/mymaps');
  console.log('   2. Create a new map or open existing map');
  console.log('   3. Click "Import" under the layer');
  console.log('   4. Upload festival-map.csv');
  console.log('   5. Select "Latitude" and "Longitude" as position columns');
  console.log('   6. Select "Name" as marker title');
  console.log('   7. Share the map and get embed code or link\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
