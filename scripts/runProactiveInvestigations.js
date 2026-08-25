#!/usr/bin/env node
/**
 * scripts/runProactiveInvestigations.js
 *
 * Real, deterministic proactive investigation trigger - "nobody asks,
 * Vantage notices." Runs check_and_open_investigation() (real
 * statistical z-score analysis, no AI call) for every real location,
 * honestly reports how many genuinely opened vs stayed quiet. Safe
 * to run repeatedly - the real duplicate-prevention logic means a
 * location with an already-open investigation into the same real
 * question is correctly skipped, not re-opened.
 *
 * Intended to run daily as part of the existing production cron,
 * after runBrainForAllLocations.js (so it reasons over the freshest
 * real data). Not yet added to the live cron - review + add manually.
 *
 * Usage:
 *   node scripts/runProactiveInvestigations.js
 *   node scripts/runProactiveInvestigations.js --location=<id>
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2);
const LOC_ARG = args.find((a) => a.startsWith('--location='));
const SINGLE_LOCATION = LOC_ARG ? LOC_ARG.split('=')[1] : null;

async function main() {
  let query = supabase.from('locations').select('id, name');
  if (SINGLE_LOCATION) query = query.eq('id', SINGLE_LOCATION);
  const { data: locations, error } = await query;
  if (error) { console.error(error.message); process.exit(1); }

  console.log(`Real proactive investigation check: ${locations.length} location(s)\n`);
  let opened = 0, quiet = 0, failed = 0;

  for (const loc of locations) {
    try {
      const { data: result, error: rpcErr } = await supabase.rpc('check_and_open_investigation', { p_location_id: loc.id });
      if (rpcErr) { console.log(`FAILED ${loc.name}: ${rpcErr.message}`); failed++; continue; }
      if (result.opened) {
        console.log(`OPENED  ${loc.name}: "${result.question}"`);
        opened++;
      } else {
        quiet++;
      }
    } catch (e) {
      console.log(`FAILED ${loc.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${opened} real investigation(s) opened, ${quiet} correctly stayed quiet, ${failed} failed.`);
  console.log('A quiet location is not a failure - it means no real, statistically justified constraint was found. Never manufactured.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
