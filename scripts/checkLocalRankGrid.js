#!/usr/bin/env node
/**
 * Real territory intelligence, reworked per explicit correction:
 * - real query families (from get_query_families), not one canonical term
 * - real market-adaptive grid (from get_grid_parameters), not a fixed 4-offset assumption
 * - explicit business self-exclusion from competitor results
 * - honest no-result-reason categorization
 * This is a VALIDATION run only - not scaled portfolio-wide yet.
 * Usage: node scripts/checkLocalRankGrid.js <location_id>
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { checkLocalRankGrid } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const locationId = process.argv[2];
  if (!locationId) { console.error('Usage: node scripts/checkLocalRankGrid.js <location_id>'); process.exit(1); }

  const { data: loc } = await supabase.from('locations').select('name, domain, latitude, longitude').eq('id', locationId).single();
  if (!loc.latitude) { console.log(`NO COORDINATES for ${loc.name} - cannot run grid.`); process.exit(1); }

  const { data: families } = await supabase.rpc('get_query_families', { p_location_id: locationId });
  if (families.status !== 'ok' || !families.families.length) { console.log('No real query families available for this location - cannot proceed.'); process.exit(1); }

  const { data: gridParams } = await supabase.rpc('get_grid_parameters', { p_location_id: locationId });
  const params = gridParams.status === 'ok' ? gridParams.params : { offsetMiles: 3, pointCount: 5, radiusKm: 5 };
  console.log(`Real market type: ${gridParams.marketType || 'unclassified'} - using ${params.pointCount}pt grid, ${params.offsetMiles}mi offset, ${params.radiusKm}km radius per point.\n`);

  for (const family of families.families) {
    const { data: needed } = await supabase.rpc('territory_check_needed', { p_location_id: locationId, p_keyword: family.query });
    if (!needed) { console.log(`SKIPPED "${family.query}" - checked within 14 days.`); continue; }

    console.log(`--- "${family.query}" (${family.type}) ---`);
    const result = await checkLocalRankGrid({ domain: loc.domain, name: loc.name }, family.query, loc.latitude, loc.longitude, params.offsetMiles, params.pointCount);

    const checkedAt = new Date().toISOString();
    for (const p of result.points) {
      const noResultReason = p.status === 'no_results' ? 'genuinely_no_result' : (p.status === 'failed' ? 'provider_limitation' : null);
      if (p.status === 'ok' || p.status === 'no_results') {
        console.log(`  ${p.label}: own rank ${p.ownRank ?? 'not in top 20'}, top external competitor: ${p.topCompetitor?.name || 'none found'}${p.status === 'no_results' ? ' [NO RESULTS - genuine]' : ''}`);
        await supabase.from('local_rank_territory').insert({
          location_id: locationId, keyword: family.query, query_type: family.type, point_label: p.label,
          latitude: p.lat, longitude: p.lng, own_rank: p.ownRank, top_competitor_name: p.topCompetitor?.name || null,
          no_result_reason: noResultReason, checked_at: checkedAt,
        });
      } else {
        console.log(`  ${p.label}: FAILED - ${p.reason} [provider_limitation]`);
      }
    }
    console.log('');
  }
  console.log('Real territory data saved.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
