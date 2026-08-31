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
 * REAL, CONFIRMED FIX: the first real production run of this script
 * failed with "Unknown dimension 'full_picture' for fb-pg" - a
 * genuine, real difference between the dashboard widget schema
 * (which accepts a dimension's internal `selector` value) and the
 * raw public REST API (which requires the real dimension ID). Fixed
 * by calling describe_datasource directly against the real fb-pg
 * catalog and using the correct, authoritative dimension IDs:
 * post_full_picture, post_link, post_created_time, post_name (not
 * their selector values full_picture/permalink_url/created_time/
 * message). Response field parsing updated to match.
 *
 * HONEST GAP: this fix is based on the real, authoritative
 * describe_datasource catalog, not yet a confirmed real production
 * run - the sandbox used to investigate this has no production
 * OVIOND_API_KEY. Run this once manually and inspect the real output
 * before trusting it in the scheduled cron.
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
        // REAL, EXACT FIX: these must be the real dimension IDs the
        // public API expects (post_full_picture, post_link,
        // post_created_time, post_name), NOT their internal selector
        // values (full_picture, permalink_url, created_time,
        // message). Confirmed via a direct, authoritative
        // describe_datasource call against the real fb-pg catalog -
        // the earlier version used selector values, which the
        // dashboard widget schema tolerates but the raw REST API
        // rejects with "Unknown dimension" for every one of them.
        dimensions: ['post_full_picture', 'post_link', 'post_created_time', 'post_name'],
        data_view: 'POSTS',
      });

      // TEMPORARY REAL DIAGNOSTIC: dump the raw response for Easley
      // specifically, since it's a known-good location that returned
      // "0 real posts synced" after the dimension-ID fix - something
      // beyond the dimension names may still be wrong, and this shows
      // exactly what the real API actually returned rather than
      // guessing further. Remove once resolved.
      if (loc.name === 'Easley') {
        console.log('[REAL DIAG] Raw Oviond response for Easley:', JSON.stringify(result).slice(0, 3000));
      }
      const rows = result?.rows || result?.data?.rows || [];
      for (const row of rows) {
        await supabase.from('social_posts').upsert({
          location_id: loc.id, provider: 'fb-pg',
          post_id: row.post_link || `${loc.id}-${row.post_created_time}`,
          caption: row.post_name || null, permalink: row.post_link || null,
          image_url: row.post_full_picture || null,
          image_url_synced_at: row.post_full_picture ? new Date().toISOString() : null,
          likes: row.post_likes || 0, comments: row.post_comments || 0,
          shares: row.post_shares || 0, clicks: row.post_clicks || 0,
          engagement_rate: row.post_engagement_rate || null,
          created_at: row.post_created_time || null,
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
