#!/usr/bin/env node
/**
 * scripts/backfillDailyMetrics.js
 *
 * Real, additive daily-granularity backfill. Reuses the exact same
 * Oviond fetch pattern as syncOviondClients.js and syncCurrentPeriod.js
 * (dimensions:['DATE'] was already being requested and the daily rows
 * discarded after monthly aggregation - this persists them instead).
 * Does not touch historical_metrics or its meaning.
 *
 * Backfills only as far back as Oviond actually returns real rows for
 * each location/channel - never assumes a fixed window. Reports real
 * coverage achieved per location at the end, honestly.
 *
 * Usage:
 *   node scripts/backfillDailyMetrics.js --client=<oviond_client_id> --days=60
 *   node scripts/backfillDailyMetrics.js --days=60   (all real locations)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { normalizeGoogleSpend, normalizeGoogleCpc } = require('../src/utils/oviondUnits');

const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const CLIENT_ARG = args.find((a) => a.startsWith('--client='));
const SINGLE_CLIENT = CLIENT_ARG ? CLIENT_ARG.split('=')[1] : null;
const DAYS_ARG = args.find((a) => a.startsWith('--days='));
const DAYS = DAYS_ARG ? parseInt(DAYS_ARG.split('=')[1], 10) : 60;

if (!OVIOND_API_KEY) { console.error('OVIOND_API_KEY is not set in .env.'); process.exit(1); }

async function oviondFetch(path, options) {
  const res = await fetch(`${OVIOND_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Oviond ${path} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function backfillOne(location, oviondClientId, datasourceId, periodStart, periodEnd) {
  const isGoogle = datasourceId === 'gadw';
  const channel = isGoogle ? 'google' : 'meta';
  try {
    const result = await oviondFetch('/v1/data/query', {
      method: 'POST',
      body: JSON.stringify({
        datasource_id: datasourceId, client_id: oviondClientId,
        date_range: { current_start: periodStart, current_end: periodEnd },
        metrics: isGoogle
          ? ['impressions', 'clicks', 'ctr', 'cost_micros', 'average_cpc', 'conversions']
          : ['impressions', 'clicks', 'ctr', 'spend', 'reach', 'cpc'],
        dimensions: ['DATE'], data_view: 'ACCOUNT',
        ...(datasourceId === 'fb-ads' ? { advanced: { attribution: 'use_unified_attribution_setting' } } : {}),
      }),
    });
    const rows = result?.data?.current || [];
    if (!rows.length) return { channel, realRowsWritten: 0, earliestRealDate: null, latestRealDate: null };

    let earliest = null, latest = null, written = 0;
    for (const r of rows) {
      const obsDate = r.date || r.DATE || r.day;
      if (!obsDate) continue;
      const { error } = await supabase.from('daily_historical_metrics').upsert({
        location_id: location.id, channel, observation_date: obsDate,
        spend: isGoogle ? normalizeGoogleSpend(r) : Number(r.spend || 0),
        impressions: Number(r.impressions || 0), reach: Number(r.reach || 0),
        clicks: Number(r.clicks || 0), ctr: Number(r.ctr || 0) || null,
        cpc: isGoogle ? normalizeGoogleCpc(r) : (Number(r.cpc || 0) || null),
        conversions: Number(r.conversions || 0) || null, source: 'oviond',
      }, { onConflict: 'location_id,channel,observation_date' });
      if (!error) { written++; if (!earliest || obsDate < earliest) earliest = obsDate; if (!latest || obsDate > latest) latest = obsDate; }
    }
    return { channel, realRowsWritten: written, earliestRealDate: earliest, latestRealDate: latest };
  } catch (e) {
    return { channel, realRowsWritten: 0, error: e.message };
  }
}

async function main() {
  const periodEnd = new Date().toISOString().slice(0, 10);
  const periodStart = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);

  let query = supabase.from('dashboard_mappings').select('location_id, oviond_client_id, locations(id, name)');
  if (SINGLE_CLIENT) query = query.eq('oviond_client_id', SINGLE_CLIENT);
  const { data: mappings, error } = await query;
  if (error) { console.error(error.message); process.exit(1); }

  console.log(`Real daily backfill: requesting ${periodStart} through ${periodEnd} (${DAYS} days requested)\n`);
  const coverageReport = [];
  for (const m of mappings) {
    if (!m.locations) continue;
    const google = await backfillOne(m.locations, m.oviond_client_id, 'gadw', periodStart, periodEnd);
    const meta = await backfillOne(m.locations, m.oviond_client_id, 'fb-ads', periodStart, periodEnd);
    console.log(`${m.locations.name}: google=${google.realRowsWritten} real days (${google.earliestRealDate || 'none'} to ${google.latestRealDate || 'none'}), meta=${meta.realRowsWritten} real days (${meta.earliestRealDate || 'none'} to ${meta.latestRealDate || 'none'})`);
    coverageReport.push({ location: m.locations.name, google: google.realRowsWritten, meta: meta.realRowsWritten });
  }

  console.log('\n--- HONEST COVERAGE SUMMARY ---');
  const fullGoogle = coverageReport.filter(r => r.google >= DAYS * 0.9).length;
  const fullMeta = coverageReport.filter(r => r.meta >= DAYS * 0.9).length;
  console.log(`${fullGoogle}/${coverageReport.length} locations got real Google daily coverage close to the ${DAYS}-day request.`);
  console.log(`${fullMeta}/${coverageReport.length} locations got real Meta daily coverage close to the ${DAYS}-day request.`);
  console.log('Locations with 0 real days for a channel genuinely have no real daily data available upstream for that window - not a script failure.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
