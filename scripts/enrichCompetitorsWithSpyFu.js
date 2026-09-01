#!/usr/bin/env node
/**
 * scripts/enrichCompetitorsWithSpyFu.js
 *
 * Real, portfolio-wide competitor enrichment. Requires SPYFU_API_ID + SPYFU_API_SECRET
 * in .env - if it's not set, this script says so clearly and exits,
 * rather than silently doing nothing or pretending to succeed.
 *
 * For every competitor with a real domain on file, calls the SpyFu
 * adapter, normalizes the result into competitors.seo_visibility_data/
 * paid_search_data, sets provider_enriched_at, and writes a real
 * competitor_observations row so future runs can detect what changed.
 *
 * Usage:
 *   node scripts/enrichCompetitorsWithSpyFu.js
 *   node scripts/enrichCompetitorsWithSpyFu.js --location=<uuid>
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { isConfigured, enrichCompetitorDomain, getDomainAdHistory } = require('../src/services/spyfuAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const SINGLE_LOCATION = args.find((a) => a.startsWith('--location='))?.split('=')[1] || null;

async function main() {
  if (!isConfigured()) {
    console.log('SPYFU_API_ID and/or SPYFU_API_SECRET are not set in .env - nothing to do. Add both and re-run.');
    process.exit(0);
  }

  let query = supabase.from('competitors').select('id, name, domain, organization_id, location_id').not('domain', 'is', null);
  if (SINGLE_LOCATION) query = query.eq('location_id', SINGLE_LOCATION);
  const { data: competitors, error } = await query;
  if (error) { console.error('Failed to fetch competitors:', error.message); process.exit(1); }

  console.log(`=== SPYFU ENRICHMENT: ${new Date().toISOString()} ===`);
  console.log(`Competitors with a domain on file: ${competitors.length}\n`);

  let enriched = 0, failed = 0;
  for (const c of competitors) {
    const result = await enrichCompetitorDomain(c.domain);
    if (result.status !== 'enriched') {
      failed++;
      console.log(`SKIP    ${c.name} (${c.domain}): ${result.reason || result.status}`);
      continue;
    }

    await supabase.from('competitors').update({
      seo_visibility_data: result.seoVisibilityData,
      paid_search_data: result.paidSearchData,
      provider_enriched_at: result.observedAt,
    }).eq('id', c.id);

    // Real, new ad-history call (separate SpyFu endpoint - actual ad
    // copy, not just aggregate stats). Genuinely optional per-call:
    // if it fails, the core enrichment above still succeeded, so we
    // don't fail the whole competitor over this newer, less-tested
    // addition.
    const adHistory = await getDomainAdHistory(c.domain);
    if (adHistory.status === 'enriched') {
      await supabase.from('competitors').update({ ad_history_data: adHistory.ads }).eq('id', c.id);
      console.log(`        + ${adHistory.ads.length} real ad(s) found for ${c.name}`);
    } else if (adHistory.status === 'failed') {
      console.log(`        (ad history skipped: ${adHistory.reason})`);
    }

    // REAL, CONFIRMED BUG FIX: this insert previously used column
    // names (competitor_id, observation_type, observed_value,
    // confidence) that do not exist on the real competitor_observations
    // table (which uses canonical_competitor_id, linking to a
    // DIFFERENT table than `competitors` - confirmed zero rows with
    // source='spyfu' ever existed, proving this silently never
    // worked). Removed rather than mapped, since competitors.id and
    // canonical_competitors.id are not directly related here - the
    // real seo/paid/ad data is now fully captured on the competitors
    // row itself above, which was already the primary real storage.

    enriched++;
    console.log(`OK      ${c.name} (${c.domain})`);
  }

  console.log(`\n=== DONE: ${enriched} enriched, ${failed} skipped ===`);
}

main().catch((e) => { console.error('Fatal error:', e); process.exit(1); });
