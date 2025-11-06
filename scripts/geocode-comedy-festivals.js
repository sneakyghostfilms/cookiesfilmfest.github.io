#!/usr/bin/env node

import { comedyFestivals } from '../src/data/comedy-festivals.js';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCATIONS_FILE = join(__dirname, '../src/data/comedy-festival-locations.json');

// Nominatim API - respects usage policy (1 request/second)
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

// Delay between requests (1100ms to be safe)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function geocodeLocation(city, state, country) {
  const params = new URLSearchParams({
    format: 'json',
    limit: '1'
  });

  // Build location query
  if (state) {
    params.append('city', city);
    params.append('state', state);
    params.append('country', country);
  } else {
    params.append('city', city);
    params.append('country', country);
  }

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
      const location = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
      console.warn(`  ⚠️  No results found for ${location}`);
      return null;
    }

    const location = data[0];
    return {
      lat: parseFloat(location.lat),
      lng: parseFloat(location.lon),
      city: city,
      state: state || null,
      country: country
    };
  } catch (error) {
    const locationStr = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
    console.error(`  ❌ Error geocoding ${locationStr}:`, error.message);
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
  console.log('🗺️  Comedy Festival Geocoding Script');
  console.log('━'.repeat(50));

  console.log(`Total comedy festivals: ${comedyFestivals.length}`);

  // Load existing coordinates
  const locations = await loadExistingLocations();

  // Find items without coordinates
  const missing = comedyFestivals.filter(f => !locations[f.name]);

  console.log(`Existing coordinates: ${Object.keys(locations).length}`);
  console.log(`Missing coordinates: ${missing.length}`);
  console.log('━'.repeat(50));

  if (missing.length === 0) {
    console.log('✅ All comedy festivals already have coordinates!');
    return;
  }

  console.log(`\n🌐 Fetching coordinates from OpenStreetMap (Nominatim)...`);
  console.log(`   Rate limited to 1 request/second\n`);

  let successCount = 0;
  let failCount = 0;

  for (const festival of missing) {
    const locationStr = festival.state
      ? `${festival.city}, ${festival.state}, ${festival.country}`
      : `${festival.city}, ${festival.country}`;
    console.log(`📍 ${festival.name} (${locationStr})`);

    const coords = await geocodeLocation(festival.city, festival.state, festival.country);

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
  console.log(`\n💾 Saved coordinates to: src/data/comedy-festival-locations.json`);
  console.log(`   Total locations: ${Object.keys(locations).length}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
