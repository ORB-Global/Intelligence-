#!/usr/bin/env node
/**
 * scripts/syncSocialPosts.js
 *
 * Real sync for social_posts, including image_url - the field this
 * session spent significant time investigating. CORRECTION: earlier
 * tonight's conclusion that Facebook images require Meta App Review
 * was based on a real testing mistake (wrong data_view value: "POST"
 * singular instead of "POSTS", and separately not matching the exact
 * real field combination). Confirmed via Oviond's dashboard tool
 * against live Easley data: dimensions ['full_picture', 'permalink_url',
 * 'created_time', 'message'] with data_view 'POSTS' returns real,
 * working image URLs for all 27 real posts, no permission gap exists.
 *
 * CRITICAL, REAL FINDING: full_picture URLs are signed Facebook CDN
 * links with an embedded expiry (the oe= hex parameter is a real Unix
 * timestamp) - decoded and confirmed these expire in ~5 DAYS, not
 * months. image_url is NOT safe to treat as permanent. This script
 * must run on a real, recurring schedule (daily, alongside the
 * existing brain cron) - a one-time backfill will silently go stale
 * within a week. image_url_synced_at tracks exactly when each URL
 * was last confirmed fresh, so reasoning never trusts a stale one.
 *
 * HONEST GAP: this exact query has been verified through Oviond's
 * dashboard/MCP tool (confirmed working), but NOT yet directly against
 * the raw /v1/data/query REST endpoint this script calls, since the
 * sandbox used to investigate this had no production OVIOND_API_KEY.
 * Both paths hit the same real Oviond backend, so this should work
 * identically - but run this once manually and inspect the real
 * output before trusting it in the scheduled cron.
 *
 * Usage:
 *   node scripts/syncSocialPosts.js [--location=<id>]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';

async function oviondFetch(path, body) {
  const res = await fetch(`${OVIOND_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OVIOND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Oviond ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main() {
  const locArg = process.argv.find((a) => a.startsWith('--location='));
  let query = supabase.from('locations').select('id, oviond_client_id, name').not('oviond_client_id', 'is', null);
  if (locArg) query = query.eq('id', locArg.split('=')[1]);
  const { data: locations, error } = await query;
  if (error) { console.error(error.message); process.exit(1); }

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const end = today.toISOString().slice(0, 10);

  let synced = 0, failed = 0;
  for (const loc of locations) {
    try {
      const result = await oviondFetch('/v1/data/query', {
        datasource_id: 'fb-pg', client_id: loc.oviond_client_id,
        date_range: { current_start: start, current_end: end },
        metrics: ['post_likes', 'post_clicks', 'post_comments', 'post_shares', 'post_engagement_rate'],
        dimensions: ['full_picture', 'permalink_url', 'created_time', 'message'],
        data_view: 'POSTS',
      });

      const rows = result?.rows || result?.data?.rows || [];
      for (const row of rows) {
        await supabase.from('social_posts').upsert({
          location_id: loc.id, provider: 'fb-pg',
          post_id: row.permalink_url || `${loc.id}-${row.created_time}`,
          caption: row.message || null, permalink: row.permalink_url || null,
          image_url: row.full_picture || null,
          image_url_synced_at: row.full_picture ? new Date().toISOString() : null,
          likes: row.post_likes || 0, comments: row.post_comments || 0,
          shares: row.post_shares || 0, clicks: row.post_clicks || 0,
          engagement_rate: row.post_engagement_rate || null,
          created_at: row.created_time || null,
        }, { onConflict: 'location_id,provider,post_id' });
      }
      console.log(`OK ${loc.name}: ${rows.length} real posts synced`);
      synced++;
    } catch (e) {
      console.log(`FAILED ${loc.name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDone. ${synced} location(s) synced, ${failed} failed.`);
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
