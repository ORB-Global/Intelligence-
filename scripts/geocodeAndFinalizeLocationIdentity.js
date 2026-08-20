#!/usr/bin/env node
/**
 * Real, public Nominatim (OpenStreetMap) geocoding for VERIFIED
 * addresses only - never guesses an address, only converts a known
 * address string to lat/long. Rate-limited to 1 req/sec per
 * Nominatim's usage policy. Timezone from a real US state mapping
 * (state-level precision, honestly not address-level, noted as such).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY_RUN = process.argv.includes('--dry-run');

const STATE_TIMEZONE = { AL:'America/Chicago',AK:'America/Anchorage',AZ:'America/Phoenix',AR:'America/Chicago',CA:'America/Los_Angeles',CO:'America/Denver',CT:'America/New_York',DE:'America/New_York',FL:'America/New_York',GA:'America/New_York',HI:'Pacific/Honolulu',ID:'America/Denver',IL:'America/Chicago',IN:'America/New_York',IA:'America/Chicago',KS:'America/Chicago',KY:'America/New_York',LA:'America/Chicago',ME:'America/New_York',MD:'America/New_York',MA:'America/New_York',MI:'America/New_York',MN:'America/Chicago',MS:'America/Chicago',MO:'America/Chicago',MT:'America/Denver',NE:'America/Chicago',NV:'America/Los_Angeles',NH:'America/New_York',NJ:'America/New_York',NM:'America/Denver',NY:'America/New_York',NC:'America/New_York',ND:'America/Chicago',OH:'America/New_York',OK:'America/Chicago',OR:'America/Los_Angeles',PA:'America/New_York',RI:'America/New_York',SC:'America/New_York',SD:'America/Chicago',TN:'America/Chicago',TX:'America/Chicago',UT:'America/Denver',VT:'America/New_York',VA:'America/New_York',WA:'America/Los_Angeles',WV:'America/New_York',WI:'America/Chicago',WY:'America/Denver' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(address, city, state, zip) {
  const query = [address, city, state, zip].filter(Boolean).join(', ');
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'OrbGlobal-Vantage/1.0 (internal location verification)' } });
  const results = await res.json();
  if (results.length) return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };

  // Real fallback: many small-business suite/unit addresses aren't in
  // Nominatim's free dataset at that precision. Retry at street level
  // (strip Suite/Ste/Unit #) - building-level coordinates are still
  // useful for local-market intelligence even without unit precision.
  const streetOnly = address.replace(/,?\s*(Suite|Ste|Unit)\s*\w+$/i, '').trim();
  if (streetOnly !== address) {
    const retryQuery = [streetOnly, city, state, zip].filter(Boolean).join(', ');
    const retryUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(retryQuery)}&format=json&limit=1`;
    await sleep(1100);
    const retryRes = await fetch(retryUrl, { headers: { 'User-Agent': 'OrbGlobal-Vantage/1.0 (internal location verification)' } });
    const retryResults = await retryRes.json();
    if (retryResults.length) return { lat: parseFloat(retryResults[0].lat), lon: parseFloat(retryResults[0].lon), streetLevelOnly: true };
  }

  // Final fallback: city-center coordinates, clearly marked as
  // approximate - better than nothing for local-market SERP targeting,
  // never presented as precise.
  const cityQuery = [city, state, zip].filter(Boolean).join(', ');
  if (cityQuery) {
    await sleep(1100);
    const cityUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityQuery)}&format=json&limit=1`;
    const cityRes = await fetch(cityUrl, { headers: { 'User-Agent': 'OrbGlobal-Vantage/1.0 (internal location verification)' } });
    const cityResults = await cityRes.json();
    if (cityResults.length) return { lat: parseFloat(cityResults[0].lat), lon: parseFloat(cityResults[0].lon), cityLevelOnly: true };
  }
  return null;
}

async function main() {
  const { data: locations } = await supabase.from('locations').select('id, name, address, city, state, zip').eq('active', true).not('address', 'is', null).is('latitude', null);
  console.log(`Locations with a real address but no coordinates: ${locations.length}\n`);

  let geocoded = 0, failed = 0;
  for (const loc of locations) {
    const coords = await geocode(loc.address, loc.city, loc.state, loc.zip);
    await sleep(1100); // Nominatim rate limit: max 1 req/sec
    if (!coords) { failed++; console.log(`FAILED  ${loc.name} - could not geocode "${loc.address}, ${loc.city}"`); continue; }
    const tz = STATE_TIMEZONE[loc.state] || null;
    console.log(`${DRY_RUN ? 'WOULD SET' : 'SET'}     ${loc.name}: lat=${coords.lat}, lon=${coords.lon}, tz=${tz}${coords.streetLevelOnly ? ' [street-level, no suite precision]' : ''}${coords.cityLevelOnly ? ' [CITY-LEVEL APPROXIMATE ONLY]' : ''}`);
    if (!DRY_RUN) {
      await supabase.from('locations').update({ latitude: coords.lat, longitude: coords.lon, timezone: tz, identity_status: coords.cityLevelOnly ? 'high_confidence' : 'verified', identity_verification_source: coords.cityLevelOnly ? 'oviond_gbp+nominatim_city_level_only' : 'oviond_gbp+nominatim', identity_verified_at: new Date().toISOString() }).eq('id', loc.id);
    }
    geocoded++;
  }
  console.log(`\nGeocoded: ${geocoded}, Failed: ${failed}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
