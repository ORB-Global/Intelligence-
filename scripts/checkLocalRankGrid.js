#!/usr/bin/env node
/**
 * Real, cost-controlled local-rank/territory check. Real 5-point
 * grid (center + 4 cardinal offsets at 3mi), refuses to re-run within
 * 14 real days for the same location+keyword (private.territory_check_needed).
 * Usage: node scripts/checkLocalRankGrid.js <location_id> "<keyword>"
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { checkLocalRankGrid } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const locationId = process.argv[2];
  const keyword = process.argv[3];
  if (!locationId || !keyword) { console.error('Usage: node scripts/checkLocalRankGrid.js <location_id> "<keyword>"'); process.exit(1); }

  const { data: needed } = await supabase.rpc('territory_check_needed', { p_location_id: locationId, p_keyword: keyword });
  if (!needed) { console.log('SKIPPED - real territory data for this location+keyword is less than 14 days old. No new calls made.'); process.exit(0); }

  const { data: loc } = await supabase.from('locations').select('name, domain, latitude, longitude').eq('id', locationId).single();
  if (!loc.latitude) { console.log(`NO COORDINATES for ${loc.name} - cannot run grid.`); process.exit(1); }

  console.log(`Checking real 5-point territory grid for ${loc.name} on "${keyword}"...`);
  const result = await checkLocalRankGrid({ domain: loc.domain, name: loc.name }, keyword, loc.latitude, loc.longitude);

  const checkedAt = new Date().toISOString();
  for (const p of result.points) {
    if (p.status !== 'ok') { console.log(`  ${p.label}: FAILED - ${p.reason}`); continue; }
    console.log(`  ${p.label}: own rank ${p.ownRank ?? 'not in top 20'}, top competitor: ${p.topCompetitor?.name || 'none'}`);
    await supabase.from('local_rank_territory').insert({
      location_id: locationId, keyword, point_label: p.label, latitude: p.lat, longitude: p.lng,
      own_rank: p.ownRank, top_competitor_name: p.topCompetitor?.name || null, checked_at: checkedAt,
    });
  }
  console.log('Real territory data saved.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
