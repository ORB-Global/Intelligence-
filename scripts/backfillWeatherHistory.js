#!/usr/bin/env node
/**
 * scripts/backfillWeatherHistory.js
 *
 * Real historical weather backfill via WeatherAPI.com history.json.
 * Bounded to what's already useful - each real location's own
 * historical_metrics date range - not a blind max-depth crawl.
 * history.json returns hourly data; this extracts real DAILY
 * business-relevant features and discards the raw hourly payload,
 * per explicit instruction not to store enormous raw data.
 *
 * Usage:
 *   node scripts/backfillWeatherHistory.js --location=<id> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_BASE = 'https://api.weatherapi.com/v1';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const get = (flag) => { const a = args.find((x) => x.startsWith(`--${flag}=`)); return a ? a.split('=')[1] : null; };
const LOCATION_ID = get('location');
const FROM_OVERRIDE = get('from');
const TO_OVERRIDE = get('to');

if (!WEATHER_API_KEY) { console.error('WEATHER_API_KEY is not set in .env.'); process.exit(1); }
if (!LOCATION_ID) { console.error('Provide --location=<id>. This script is bounded per-location by design.'); process.exit(1); }

function dateRange(from, to) {
  const dates = [];
  let d = new Date(from);
  const end = new Date(to);
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return dates;
}

// Real, deterministic severe-weather classification from real daily
// aggregates - not an AI judgment call, a plain threshold check.
function classifySevere(dayHours) {
  const totalPrecipIn = dayHours.reduce((s, h) => s + (h.precip_in || 0), 0);
  const totalSnowCm = dayHours.reduce((s, h) => s + (h.snow_cm || 0), 0);
  const maxGustMph = Math.max(...dayHours.map((h) => h.gust_mph || 0));
  const maxTempF = Math.max(...dayHours.map((h) => h.temp_f || -999));
  const minTempF = Math.min(...dayHours.map((h) => h.temp_f || 999));
  const reasons = [];
  if (totalPrecipIn >= 1.0) reasons.push(`heavy rain (${totalPrecipIn.toFixed(2)}in)`);
  if (totalSnowCm >= 2.5) reasons.push(`snow (${(totalSnowCm / 2.54).toFixed(1)}in)`);
  if (maxGustMph >= 40) reasons.push(`high wind gusts (${maxGustMph.toFixed(0)}mph)`);
  if (maxTempF >= 100) reasons.push(`extreme heat (${maxTempF.toFixed(0)}F)`);
  if (minTempF <= 20) reasons.push(`extreme cold (${minTempF.toFixed(0)}F)`);
  return { isSevere: reasons.length > 0, reason: reasons.join(', ') || null, totalPrecipIn, totalSnowCm };
}

async function fetchHistoryDay(lat, lon, date) {
  const res = await fetch(`${WEATHER_BASE}/history.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&dt=${date}`);
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; err.body = await res.text(); throw err; }
  return res.json();
}

async function main() {
  const { data: location } = await supabase.from('locations').select('id, name, latitude, longitude').eq('id', LOCATION_ID).maybeSingle();
  if (!location || !location.latitude) { console.error('Real location not found or has no real coordinates.'); process.exit(1); }

  let from = FROM_OVERRIDE, to = TO_OVERRIDE;
  if (!from || !to) {
    const { data: range } = await supabase.from('historical_metrics').select('period_start').eq('location_id', LOCATION_ID).order('period_start', { ascending: true }).limit(1);
    const { data: rangeEnd } = await supabase.from('historical_metrics').select('period_start').eq('location_id', LOCATION_ID).order('period_start', { ascending: false }).limit(1);
    from = from || range?.[0]?.period_start;
    to = to || rangeEnd?.[0]?.period_start;
  }
  if (!from || !to) { console.error('No real historical_metrics range exists for this location - nothing to bound the backfill against.'); process.exit(1); }

  const dates = dateRange(from, to);
  console.log(`Real weather backfill: ${location.name}, ${dates.length} real day(s) requested (${from} to ${to})\n`);

  let written = 0, failed = 0, firstFailureStatus = null;
  for (const date of dates) {
    try {
      const result = await fetchHistoryDay(location.latitude, location.longitude, date);
      const day = result?.forecast?.forecastday?.[0];
      if (!day) { failed++; continue; }
      const hours = day.hour || [];
      const severe = classifySevere(hours);
      const { error } = await supabase.from('daily_weather_observations').upsert({
        location_id: location.id, observation_date: date,
        temp_high_f: day.day.maxtemp_f, temp_low_f: day.day.mintemp_f,
        precip_inches: day.day.totalprecip_in, snow_inches: severe.totalSnowCm / 2.54,
        conditions: day.day.condition?.text || null, is_forecast: false,
        is_severe: severe.isSevere, severe_reason: severe.reason,
        provider: 'weatherapi.com',
      }, { onConflict: 'location_id,observation_date' });
      if (error) { console.log(`  DB error ${date}: ${error.message}`); failed++; } else { written++; }
    } catch (e) {
      if (!firstFailureStatus) firstFailureStatus = e.status;
      failed++;
      if (failed <= 3) console.log(`  FAILED ${date}: HTTP ${e.status} - ${(e.body || '').slice(0, 150)}`);
    }
  }

  console.log(`\nDone. ${written} real day(s) written, ${failed} failed.`);
  if (failed > 0 && written === 0) {
    console.log(`Every real date failed (first failure: HTTP ${firstFailureStatus}) - this real plan likely does not support this date range. Check the failure detail above.`);
  } else if (failed > 0) {
    console.log(`Some real dates failed - this may indicate the actual real depth limit of this plan. Check which dates failed above.`);
  }
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
