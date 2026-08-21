#!/usr/bin/env node
/**
 * Real, read-only diagnostic: tests whether Oviond's /v1/data/query
 * endpoint actually supports campaign/keyword-level data_view and
 * dimensions, which the current sync script has never requested.
 * Tests against Easley's real Google Ads connection. No writes.
 */
require('dotenv').config();
const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';
const EASLEY_OVIOND_CLIENT_ID = 'asEHbZxESAKBDSSjj';

async function oviondFetch(path, options = {}) {
  const res = await fetch(`${OVIOND_BASE}${path}`, {
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

async function tryQuery(label, body) {
  console.log(`\n=== ${label} ===`);
  const result = await oviondFetch('/v1/data/query', { method: 'POST', body: JSON.stringify(body) });
  console.log(`HTTP ${result.status}`);
  console.log(JSON.stringify(result.data, null, 2).slice(0, 2000));
}

async function main() {
  const dateRange = { current_start: '2026-07-01', current_end: '2026-07-31' };

  await tryQuery('Google Ads - CAMPAIGN data_view + dimensions', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks', 'cost_micros'], dimensions: ['DATE', 'CAMPAIGN'], data_view: 'CAMPAIGN',
  });

  await tryQuery('Google Ads - KEYWORD data_view + dimensions', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks'], dimensions: ['DATE', 'KEYWORD'], data_view: 'KEYWORD',
  });

  await tryQuery('Google Ads - conversions metric probe', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'conversions', 'conversions_value'], dimensions: ['DATE'], data_view: 'ACCOUNT',
  });

  await tryQuery('Meta Ads - CAMPAIGN data_view + dimensions', {
    datasource_id: 'fb-ads', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks', 'spend'], dimensions: ['DATE', 'CAMPAIGN'], data_view: 'CAMPAIGN',
  });

  await tryQuery('Facebook Page - POST data_view + dimensions', {
    datasource_id: 'fb-pg', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['post_engagements', 'reach'], dimensions: ['DATE', 'POST'], data_view: 'POST',
  });
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
