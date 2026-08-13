#!/usr/bin/env node
/**
 * scripts/runBrainForAllLocations.js
 *
 * The scheduled pipeline: SYNC (separate script) has already run ->
 * this runs the deterministic Brain for every active location.
 * One location's failure never stops the others (per-location
 * try/catch, matching the isolation pattern already used in
 * syncOviondClients.js).
 *
 * Usage:
 *   node scripts/runBrainForAllLocations.js                (all active locations)
 *   node scripts/runBrainForAllLocations.js --location=<uuid>   (single, for testing)
 *
 * Intended cron schedule: after the nightly Oviond sync completes,
 * e.g. via crontab:
 *   0 6 * * * cd /home/ubuntu/orb-intelligence && node scripts/syncOviondClients.js >> logs/sync.log 2>&1 && node scripts/runBrainForAllLocations.js >> logs/brain.log 2>&1
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const SINGLE_LOCATION = args.find((a) => a.startsWith('--location='))?.split('=')[1] || null;

async function runOne(locationId, name) {
  const { error: brainError } = await supabase.rpc('run_location_brain', { p_location_id: locationId });
  if (brainError) throw new Error(`run_location_brain failed: ${brainError.message}`);

  const { error: competitorError } = await supabase.rpc('detect_competitor_changes', { p_location_id: locationId });
  if (competitorError) throw new Error(`detect_competitor_changes failed: ${competitorError.message}`);
}

async function main() {
  let query = supabase.from('locations').select('id, name').eq('active', true);
  if (SINGLE_LOCATION) query = query.eq('id', SINGLE_LOCATION);

  const { data: locations, error } = await query;
  if (error) { console.error('Failed to fetch locations:', error.message); process.exit(1); }

  console.log(`=== BRAIN RUN: ${new Date().toISOString()} ===`);
  console.log(`Locations: ${locations.length}\n`);

  let succeeded = 0, failed = 0;
  for (const loc of locations) {
    try {
      await runOne(loc.id, loc.name);
      succeeded++;
      console.log(`OK      ${loc.name}`);
    } catch (e) {
      failed++;
      console.log(`FAILED  ${loc.name}: ${e.message}`);
    }
  }

  // MONITOR OUTCOME -> LEARN step: re-checks any investigation whose
  // next_check_at has arrived, across the whole portfolio in one call.
  try {
    const { data: rechecked, error: recheckError } = await supabase.rpc('recheck_due_investigations');
    if (recheckError) throw recheckError;
    console.log(`\nInvestigations re-checked: ${rechecked}`);
  } catch (e) {
    console.log(`\nInvestigation recheck step failed: ${e.message}`);
  }

  // Cross-portfolio pattern learning - the genuinely unique step:
  // aggregates what's actually working across all 64 managed
  // businesses, not one at a time.
  try {
    const { data: categoriesRefreshed, error: patternError } = await supabase.rpc('refresh_portfolio_patterns');
    if (patternError) throw patternError;
    console.log(`Portfolio pattern categories refreshed: ${categoriesRefreshed}`);
  } catch (e) {
    console.log(`Portfolio pattern refresh failed: ${e.message}`);
  }

  console.log(`\n=== DONE: ${succeeded} succeeded, ${failed} failed ===`);
  process.exit(failed > 0 && succeeded === 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal error:', e); process.exit(1); });
