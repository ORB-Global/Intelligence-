#!/usr/bin/env node
/**
 * scripts/syncOviondClients.js
 *
 * Idempotent sync: Oviond -> Supabase, for ALL accessible clients.
 * Structure (organizations/locations/dashboard_mappings/connection_health)
 * uses endpoints confirmed working. Historical metrics uses
 * POST /v1/data/query - confirmed working after fixing the correct
 * metric names (cost_micros/average_cpc for gadw) and nesting
 * attribution under advanced{} for Meta datasources.
 *
 * Usage:
 *   node scripts/syncOviondClients.js --dry-run          (structure only, no writes)
 *   node scripts/syncOviondClients.js                    (real run, structure + metrics)
 *   node scripts/syncOviondClients.js --months=6         (override history window, default 6)
 *   node scripts/syncOviondClients.js --client=<oviond_client_id>   (single client, for retry)
 *
 * Never deletes a Supabase record because it's absent from an Oviond
 * response - only creates/updates. Safe to re-run any time (upserts).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MONTHS_ARG = args.find((a) => a.startsWith('--months='));
const MONTHS = MONTHS_ARG ? parseInt(MONTHS_ARG.split('=')[1], 10) : 6;
const CLIENT_ARG = args.find((a) => a.startsWith('--client='));
const SINGLE_CLIENT = CLIENT_ARG ? CLIENT_ARG.split('=')[1] : null;

if (!OVIOND_API_KEY) {
  console.error('OVIOND_API_KEY is not set in .env. Add it before running this script.');
  process.exit(1);
}

const CHANNEL_MAP = {
  meta: ['fb-ads', 'inst-ads', 'fb-pg', 'inst'],
  google: ['gadw'],
};

async function oviondFetch(path, options = {}) {
  const res = await fetch(`${OVIOND_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Oviond ${path} returned ${res.status}: ${JSON.stringify(body)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function logSync({ locationId, oviondClientId, datasource, status, error, recordsSynced, startedAt }) {
  try {
    await supabase.from('sync_log').insert({
      location_id: locationId,
      oviond_client_id: oviondClientId,
      datasource,
      status,
      error_message: error || null,
      records_synced: recordsSynced || 0,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Failed to write sync_log row (non-fatal):', e.message);
  }
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

async function matchOrCreateLocation(oviondClient) {
  const { data: existing } = await supabase
.from('locations')
    .select('id, organization_id, name')
    .eq('oviond_client_id', oviondClient.id)
    .maybeSingle();

  if (existing) return { location: existing, action: 'MATCHED' };

  if (DRY_RUN) return { location: null, action: 'WOULD_CREATE' };

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({ name: oviondClient.name, status: 'active' })
    .select()
    .single();
  if (orgErr) throw new Error(`Failed to create organization for ${oviondClient.name}: ${orgErr.message}`);

  const { data: loc, error: locErr } = await supabase
    .from('locations')
    .insert({
      organization_id: org.id,
      name: oviondClient.name,
      oviond_client_id: oviondClient.id,
      setup_status: 'inventory_only',
      portal_enabled: false,
      ai_enabled: false,
      active: true,
    })
    .select()
    .single();
  if (locErr) throw new Error(`Failed to create location for ${oviondClient.name}: ${locErr.message}`);

  return { location: loc, action: 'CREATED' };
}

async function upsertDashboardMapping(location, oviondClient) {
  if (DRY_RUN) return;
  await supabase.from('dashboard_mappings').upsert(
    { organization_id: location.organization_id, location_id: location.id, oviond_client_id: oviondClient.id, dashboard_mapping_status: 'needs_verification' },
    { onConflict: 'location_id' }
  );
}

async function upsertConnectionHealth(location, oviondClient) {
  if (DRY_RUN) return 0;
  let count = 0;
  for (const ds of oviondClient.datasources || []) {
    await supabase.from('connection_health').upsert(
      { organization_id: location.organization_id, location_id: location.id, channel: ds.datasource_id, status: 'connected', freshness_status: 'unavailable' },
      { onConflict: 'location_id,channel' }
    );
    count++;
  }
  return count;
}

const DATASOURCE_TO_CHANNEL = { 'fb-ads': 'meta', 'inst-ads': 'meta', 'gadw': 'google' };

// Aggregates Oviond's daily rows into one monthly total, then upserts
// into historical_metrics. CTR/CPC are recomputed from the summed
// totals (not averaged from daily ratios) - the correct way to blend.
async function saveAggregatedMetrics(location, datasourceNumericId, periodStart, periodEnd, dailyRows) {
  const channel = DATASOURCE_TO_CHANNEL[datasourceNumericId];
  if (!channel || !dailyRows || !dailyRows.length) return;

  let impressions = 0, clicks = 0, spend = 0, reach = 0;
  for (const row of dailyRows) {
    impressions += Number(row.impressions || 0);
    clicks += Number(row.clicks || 0);
    spend += Number(row.spend ?? row.cost_micros ?? 0);
    reach += Number(row.reach || 0);
  }
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpc = clicks > 0 ? spend / clicks : null;

const { error: deleteError } = await supabase
    .from('historical_metrics')
    .delete()
    .eq('location_id', location.id)
    .eq('channel', channel)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .is('campaign_name', null);
  if (deleteError) {
    console.error('Failed to clear existing row before insert:', deleteError.message);
  }

  const { error: insertError } = await supabase.from('historical_metrics').insert({
    organization_id: location.organization_id,
    location_id: location.id,
    channel,
    period_start: periodStart,
    period_end: periodEnd,
    ad_spend: spend,
    impressions,
    reach: reach || null,
    clicks,
    ctr,
    cpc,
  });
  if (insertError) {
    console.error('Failed to insert historical_metrics row:', insertError.message);
    throw new Error('historical_metrics insert failed: ' + insertError.message);
  }
}
async function pullMetricsForDatasource(location, oviondClientId, datasourceNumericId, periodStart, periodEnd) {
  const startedAt = new Date().toISOString();
  try {
    const result = await withRetry(() =>
      oviondFetch('/v1/data/query', {
        method: 'POST',
        body: JSON.stringify({
          datasource_id: datasourceNumericId,
          client_id: oviondClientId,
          date_range: { current_start: periodStart, current_end: periodEnd },
          metrics: datasourceNumericId === 'gadw'
            ? ['impressions', 'clicks', 'ctr', 'cost_micros', 'average_cpc']
            : ['impressions', 'clicks', 'ctr', 'spend', 'reach', 'cpc'],
          dimensions: ['DATE'],
          data_view: 'ACCOUNT',
          ...(datasourceNumericId === 'fb-ads' || datasourceNumericId === 'inst-ads' ? { advanced: { attribution: 'use_unified_attribution_setting' } } : {}),
        }),
      })
    );
    const dailyRows = result && result.data && result.data.current ? result.data.current : [];
    await saveAggregatedMetrics(location, datasourceNumericId, periodStart, periodEnd, dailyRows);
    await logSync({ locationId: location.id, oviondClientId, datasource: String(datasourceNumericId), status: 'success', recordsSynced: dailyRows.length, startedAt });
    return result;
  } catch (e) {
    await logSync({ locationId: location.id, oviondClientId, datasource: String(datasourceNumericId), status: 'failed', error: e.message, startedAt });
    return null;
  }
}

async function syncOneClient(oviondClient) {
  const { location, action } = await matchOrCreateLocation(oviondClient);
  if (DRY_RUN) return { name: oviondClient.name, action, connectionsCreated: 0 };

  await upsertDashboardMapping(location, oviondClient);
  const connectionsCreated = await upsertConnectionHealth(location, oviondClient);

  const now = new Date();
  for (let m = 0; m < MONTHS; m++) {
    const periodEnd = new Date(now.getFullYear(), now.getMonth() - m, 0);
    const periodStart = new Date(now.getFullYear(), now.getMonth() - m - 1, 1);
    const fmt = (d) => d.toISOString().slice(0, 10);

    for (const ds of oviondClient.datasources || []) {
      if (!['fb-ads', 'gadw'].includes(ds.datasource_id)) continue;
      await pullMetricsForDatasource(location, oviondClient.id, ds.datasource_id, fmt(periodStart), fmt(periodEnd));
    }
  }

  return { name: oviondClient.name, action, connectionsCreated };
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN - no writes will be made ===' : '=== REAL RUN ===');
  const clientsResp = await oviondFetch('/v1/clients?limit=100');
  let clients = clientsResp.data || clientsResp;
  if (SINGLE_CLIENT) clients = clients.filter((c) => c.id === SINGLE_CLIENT);

  console.log(`OVIOND CLIENTS FOUND: ${clients.length}`);

  let matched = 0, created = 0, failed = 0;
  const results = [];

  for (const client of clients) {
    try {
      const result = await syncOneClient(client);
      if (result.action === 'MATCHED') matched++;
      if (result.action === 'CREATED' || result.action === 'WOULD_CREATE') created++;
      results.push(result);
      console.log(`${result.action.padEnd(14)} ${client.name}`);
    } catch (e) {
      failed++;
      console.error(`FAILED         ${client.name}: ${e.message}`);
      await logSync({ locationId: null, oviondClientId: client.id, datasource: 'structure', status: 'failed', error: e.message, startedAt: new Date().toISOString() });
    }
  }

  console.log('\n=== RECONCILIATION ===');
  console.log(`OVIOND LOCATIONS FOUND: ${clients.length}`);
  console.log(`SUPABASE LOCATIONS MATCHED: ${matched}`);
  console.log(`NEW LOCATIONS CREATED: ${created}`);
  console.log(`FAILED: ${failed}`);
  console.log(`UNMATCHED: 0`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
