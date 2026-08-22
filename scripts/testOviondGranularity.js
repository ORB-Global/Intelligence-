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
    advanced: { attribution: 'use_unified_attribution_setting' },
  });

  await tryQuery('Facebook Page - POSTS data_view (real, confirmed valid by Oviond error message)', {
    datasource_id: 'fb-pg', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['post_engagements', 'reach'], dimensions: ['DATE'], data_view: 'POSTS',
  });

  await tryQuery('Google Ads - intentionally invalid data_view (to reveal the real valid list)', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions'], dimensions: ['DATE'], data_view: 'INVALID_PROBE',
  });

  await tryQuery('Meta Ads - intentionally invalid data_view (to reveal the real valid list)', {
    datasource_id: 'fb-ads', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions'], dimensions: ['DATE'], data_view: 'INVALID_PROBE',
    advanced: { attribution: 'use_unified_attribution_setting' },
  });

  await tryQuery('Facebook Page POSTS - invalid metric probe (to reveal real valid post-level metric names)', {
    datasource_id: 'fb-pg', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['INVALID_METRIC_PROBE'], dimensions: ['DATE'], data_view: 'POSTS',
  });

  // Real, confirmed-valid views - checking actual field-level data
  await tryQuery('Google Ads - real CAMPAIGNS view (does it return campaign names?)', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks', 'cost_micros'], dimensions: ['DATE'], data_view: 'CAMPAIGNS',
  });

  await tryQuery('Google Ads - real SEARCH_TERMS view (actual search queries)', {
    datasource_id: 'gadw', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks'], dimensions: ['DATE'], data_view: 'SEARCH_TERMS',
  });

  await tryQuery('Meta Ads - real CAMPAIGNS view (does it return campaign names?)', {
    datasource_id: 'fb-ads', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks', 'spend'], dimensions: ['DATE'], data_view: 'CAMPAIGNS',
    advanced: { attribution: 'use_unified_attribution_setting' },
  });

  await tryQuery('Meta Ads - CAMPAIGNS view WITH campaign as a dimension (not just a view)', {
    datasource_id: 'fb-ads', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions', 'clicks', 'spend'], dimensions: ['DATE', 'CAMPAIGN_NAME'], data_view: 'CAMPAIGNS',
    advanced: { attribution: 'use_unified_attribution_setting' },
  });

  await tryQuery('Facebook POSTS - batch of plausible real metric names', {
    datasource_id: 'fb-pg', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['reach', 'engagement', 'likes', 'comments', 'shares', 'post_id', 'permalink_url', 'message', 'created_time'], dimensions: ['DATE'], data_view: 'POSTS',
  });

  await tryQuery('Meta Ads - invalid dimension probe (reveal real valid dimension list)', {
    datasource_id: 'fb-ads', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['impressions'], dimensions: ['INVALID_DIM_PROBE'], data_view: 'CAMPAIGNS',
    advanced: { attribution: 'use_unified_attribution_setting' },
  });

  // Real, targeted probe using Oviond's OWN marketing-page language
  // ("post views", "post clicks", "post reach") rather than guessed
  // generic Graph API metric names - their public docs describe a
  // real Facebook Overview report template with post-level metrics.
  await tryQuery('Facebook POSTS - metric names from Oviond\'s own docs (post_views, post_clicks, post_reach)', {
    datasource_id: 'fb-pg', client_id: EASLEY_OVIOND_CLIENT_ID, date_range: dateRange,
    metrics: ['post_views'], dimensions: ['DATE'], data_view: 'POSTS',
  });
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
