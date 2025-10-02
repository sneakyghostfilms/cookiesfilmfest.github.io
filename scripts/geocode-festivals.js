#!/usr/bin/env node

import { festivals } from '../src/data/festivals.js';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCATIONS_FILE = join(__dirname, '../src/data/festival-locations.json');

// Nominatim API - respects usage policy (1 request/second)
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

// Delay between requests (1100ms to be safe)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function geocodeCity(city) {
  // Handle compound cities like "Lancaster/Lititz"
  const primaryCity = city.split('/')[0].trim();

  const params = new URLSearchParams({
    city: primaryCity,
    state: 'Pennsylvania',
    country: 'USA',
    format: 'json',
    limit: '1'
  });

  const url = `${NOMINATIM_API}?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CookiesFilmFest-Website/1.0 (https://cookiesfilmfest.com)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.length === 0) {
      console.warn(`  ⚠️  No results found for ${city}, PA`);
      return null;
    }

    const location = data[0];
    return {
      lat: parseFloat(location.lat),
      lng: parseFloat(location.lon),
      city: city
    };
  } catch (error) {
    console.error(`  ❌ Error geocoding ${city}:`, error.message);
    return null;
  }
}

async function loadExistingLocations() {
  try {
    const data = await readFile(LOCATIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('📍 No existing locations file found, will create new one');
      return {};
    }
    throw error;
  }
}

async function saveLocations(locations) {
  const json = JSON.stringify(locations, null, 2);
  await writeFile(LOCATIONS_FILE, json, 'utf-8');
}

async function main() {
  console.log('🗺️  Festival Geocoding Script');
  console.log('━'.repeat(50));
  console.log(`Total festivals: ${festivals.length}`);

  // Load existing coordinates
  const locations = await loadExistingLocations();

  // Find festivals without coordinates
  const missing = festivals.filter(f => !locations[f.name]);

  console.log(`Existing coordinates: ${Object.keys(locations).length}`);
  console.log(`Missing coordinates: ${missing.length}`);
  console.log('━'.repeat(50));

  if (missing.length === 0) {
    console.log('✅ All festivals already have coordinates!');
    return;
  }

  console.log(`\n🌐 Fetching coordinates from OpenStreetMap (Nominatim)...`);
  console.log(`   Rate limited to 1 request/second\n`);

  let successCount = 0;
  let failCount = 0;

  for (const festival of missing) {
    console.log(`📍 ${festival.name} (${festival.city}, PA)`);

    const coords = await geocodeCity(festival.city);

    if (coords) {
      locations[festival.name] = coords;
      console.log(`   ✓ ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
      successCount++;
    } else {
      failCount++;
    }

    // Respect rate limit (except for last request)
    if (festival !== missing[missing.length - 1]) {
      await delay(1100);
    }
  }

  console.log('\n' + '━'.repeat(50));
  console.log(`✅ Successfully geocoded: ${successCount}`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
  }

  // Save results
  await saveLocations(locations);
  console.log(`\n💾 Saved coordinates to: src/data/festival-locations.json`);
  console.log(`   Total locations: ${Object.keys(locations).length}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
