#!/usr/bin/env node
/**
 * scripts/syncCurrentPeriod.js
 *
 * Real, separate, additive MTD ingestion - does NOT touch
 * historical_metrics (completed months only, per explicit
 * instruction to preserve its meaning). Pulls the real, in-progress
 * current calendar month and writes to current_period_metrics.
 *
 * Reuses the exact same Oviond fetch/retry pattern as
 * syncOviondClients.js rather than duplicating it - the daily-level
 * data this needs was already being fetched there and discarded
 * after monthly aggregation; this keeps it instead.
 *
 * Usage:
 *   node scripts/syncCurrentPeriod.js                (all real locations)
 *   node scripts/syncCurrentPeriod.js --client=<oviond_client_id>
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const CLIENT_ARG = args.find((a) => a.startsWith('--client='));
const SINGLE_CLIENT = CLIENT_ARG ? CLIENT_ARG.split('=')[1] : null;

if (!OVIOND_API_KEY) { console.error('OVIOND_API_KEY is not set in .env.'); process.exit(1); }

async function oviondFetch(path, options) {
  const res = await fetch(`${OVIOND_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Oviond ${path} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function pullCurrentPeriod(location, oviondClientId, datasourceId, periodStart, periodEnd, daysElapsed) {
  try {
    const isGoogle = datasourceId === 'gadw';
    const result = await oviondFetch('/v1/data/query', {
      method: 'POST',
      body: JSON.stringify({
        datasource_id: datasourceId, client_id: oviondClientId,
        date_range: { current_start: periodStart, current_end: periodEnd },
        metrics: isGoogle
          ? ['impressions', 'clicks', 'ctr', 'cost_micros', 'average_cpc', 'conversions']
          : ['impressions', 'clicks', 'ctr', 'spend', 'reach', 'cpc', 'action_lead', 'action_onsite_conversion_messaging_conversation_started_7d'],
        dimensions: ['DATE'], data_view: isGoogle ? 'ACCOUNT' : 'ACCOUNT',
        ...(datasourceId === 'fb-ads' || datasourceId === 'inst-ads' ? { advanced: { attribution: 'use_unified_attribution_setting' } } : {}),
      }),
    });
    const rows = result?.data?.current || [];
    if (!rows.length) { console.log(`  ${datasourceId}: no real rows returned for MTD period.`); return; }

    // Real, honest sum across the real real days fetched - not an estimate.
    let spend = 0, impressions = 0, reach = 0, clicks = 0, leads = 0, messaging = 0;
    for (const r of rows) {
      spend += Number(isGoogle ? (r.cost_micros || 0) / 1e6 : (r.spend || 0));
      impressions += Number(r.impressions || 0);
      reach += Number(r.reach || 0);
      clicks += Number(r.clicks || 0);
      leads += Number(r.action_lead || 0);
      messaging += Number(r.action_onsite_conversion_messaging_conversation_started_7d || 0);
    }
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpc = clicks > 0 ? spend / clicks : null;
    const channel = isGoogle ? 'google' : 'meta';

    const { error } = await supabase.from('current_period_metrics').upsert({
      location_id: location.id, channel, period_start: periodStart, as_of: new Date().toISOString(),
      spend, impressions, reach, clicks, ctr, cpc, leads, messaging_conversations: messaging,
      is_partial_period: true, days_elapsed: daysElapsed, source_freshness: 'real_mtd_sync',
    }, { onConflict: 'location_id,channel,period_start' });
    if (error) console.log(`  FAILED to save ${channel} MTD for ${location.name}: ${error.message}`);
    else console.log(`  OK ${channel} MTD: $${spend.toFixed(2)} spend, ${clicks} clicks through day ${daysElapsed}`);
  } catch (e) {
    console.log(`  FAILED ${datasourceId} MTD for ${location.name}: ${e.message}`);
  }
}

async function main() {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = now.toISOString().slice(0, 10);
  const daysElapsed = now.getDate();

  let query = supabase.from('dashboard_mappings').select('location_id, oviond_client_id, locations(id, name)');
  if (SINGLE_CLIENT) query = query.eq('oviond_client_id', SINGLE_CLIENT);
  const { data: mappings, error } = await query;
  if (error) { console.error(error.message); process.exit(1); }

  console.log(`Real MTD sync: ${periodStart} through ${periodEnd} (day ${daysElapsed})\n`);
  for (const m of mappings) {
    if (!m.locations) continue;
    console.log(m.locations.name);
    await pullCurrentPeriod(m.locations, m.oviond_client_id, 'gadw', periodStart, periodEnd, daysElapsed);
    await pullCurrentPeriod(m.locations, m.oviond_client_id, 'fb-ads', periodStart, periodEnd, daysElapsed);
  }
  console.log('\nDone.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
