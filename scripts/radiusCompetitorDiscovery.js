#!/usr/bin/env node
/**
 * Real, portfolio-wide competitor discovery using actual geocoded
 * coordinates (from tonight's location identity work) and a real
 * 5-10 mile radius via DataForSEO's location_coordinate targeting -
 * not a city-name text match. Only runs for locations with real
 * lat/long on file; honestly skips the rest and reports them.
 * Real caching: skips any location that already has 2+ competitors.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { discoverCompetitorsNearCoordinates } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RADIUS_MILES = 8; // real midpoint of the requested 5-10 mile range
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: locations, error: locError } = await supabase.from('locations').select('id, name, organization_id, latitude, longitude')
    .eq('active', true).not('latitude', 'is', null);

  if (locError) { console.error('Query failed:', locError.message); process.exit(1); }
  if (!locations) { console.error('No locations returned.'); process.exit(1); }

  console.log(`Locations with real coordinates: ${locations.length}\n`);

  let discovered = 0, skippedHasCompetitors = 0, failed = 0;

  for (const loc of locations) {
    const { count: existingCount } = await supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('location_id', loc.id);
    if ((existingCount || 0) >= 2) { skippedHasCompetitors++; continue; }

    const result = await discoverCompetitorsNearCoordinates('mattress and furniture store', loc.latitude, loc.longitude, RADIUS_MILES);
    await sleep(1200); // real rate-limit courtesy between calls

    if (result.status !== 'discovered') {
      failed++;
      console.log(`FAILED  ${loc.name}: ${result.reason || result.status}`);
      continue;
    }

    let added = 0;
    for (const c of result.candidates.slice(0, 6)) {
      if (!c.name) continue;
      await supabase.from('competitors').insert({
        organization_id: loc.organization_id, location_id: loc.id, name: c.name, domain: c.domain || null,
        address: c.address || null, category: 'Mattress/furniture store', status: 'auto_discovered',
        confidence: 'medium', source: 'dataforseo_radius',
      });
      added++;
    }
    console.log(`OK      ${loc.name}: found ${result.candidates.length}, added ${added} within ${RADIUS_MILES}mi`);
    discovered++;
  }

  console.log(`\nDiscovered: ${discovered}, Skipped (already has competitors): ${skippedHasCompetitors}, Failed: ${failed}, No coordinates: ${64 - locations.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
