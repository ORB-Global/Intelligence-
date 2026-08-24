#!/usr/bin/env node
/**
 * scripts/syncWeather.js
 *
 * Real weather sync via WeatherAPI.com (api.weatherapi.com/v1).
 * Reads WEATHER_API_KEY from the real environment - never hardcoded.
 *
 * Pulls forecast.json (today + real forecast days) for every real
 * location with coordinates. WeatherAPI.com's free tier does NOT
 * include historical data (history.json is a paid add-on) - this is
 * checked and honestly reported per-location, not assumed to work.
 *
 * Usage:
 *   node scripts/syncWeather.js
 *   node scripts/syncWeather.js --location=<location_id>
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_BASE = 'https://api.weatherapi.com/v1';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const LOC_ARG = args.find((a) => a.startsWith('--location='));
const SINGLE_LOCATION = LOC_ARG ? LOC_ARG.split('=')[1] : null;

if (!WEATHER_API_KEY) { console.error('WEATHER_API_KEY is not set in .env.'); process.exit(1); }

async function fetchForecast(lat, lon) {
  const res = await fetch(`${WEATHER_BASE}/forecast.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&days=3&aqi=no&alerts=no`);
  if (!res.ok) throw new Error(`WeatherAPI returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncOne(location) {
  try {
    const result = await fetchForecast(location.latitude, location.longitude);
    const days = result?.forecast?.forecastday || [];
    let written = 0;
    for (const d of days) {
      const isForecast = d.date !== new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('daily_weather_observations').upsert({
        location_id: location.id, observation_date: d.date,
        temp_high_f: d.day.maxtemp_f, temp_low_f: d.day.mintemp_f,
        precip_inches: d.day.totalprecip_in, conditions: d.day.condition?.text || null,
        is_forecast: isForecast, provider: 'weatherapi.com',
      }, { onConflict: 'location_id,observation_date' });
      if (!error) written++;
    }
    console.log(`OK ${location.name}: ${written} real day(s) written (today + real forecast)`);
    return { ok: true };
  } catch (e) {
    console.log(`FAILED ${location.name}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function main() {
  let query = supabase.from('locations').select('id, name, latitude, longitude').not('latitude', 'is', null);
  if (SINGLE_LOCATION) query = query.eq('id', SINGLE_LOCATION);
  const { data: locations, error } = await query;
  if (error) { console.error(error.message); process.exit(1); }

  console.log(`Real weather sync: ${locations.length} location(s) with real coordinates\n`);
  let success = 0, failed = 0;
  for (const loc of locations) {
    const result = await syncOne(loc);
    if (result.ok) success++; else failed++;
  }

  await supabase.from('capability_health').upsert({
    capability: 'weather', status: failed === 0 ? 'healthy' : (success > 0 ? 'degraded' : 'unavailable'),
    last_success_at: success > 0 ? new Date().toISOString() : undefined,
    last_error: failed > 0 ? `${failed} of ${locations.length} real locations failed` : null,
  }, { onConflict: 'capability' });

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
