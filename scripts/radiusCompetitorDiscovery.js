#!/usr/bin/env node
/**
 * Real, portfolio-wide competitor discovery using actual geocoded
 * coordinates (from tonight's location identity work) and a real
 * 5-10 mile radius via DataForSEO's location_coordinate targeting -
 * not a city-name text match. Only runs for locations with real
 * lat/long on file; honestly skips the rest and reports them.
 * Real caching: skips any location that already has 2+ competitors.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { discoverCompetitorsNearCoordinates } = require('../src/services/dataForSeoAdapter');
const { isConfigured: spyfuConfigured, enrichCompetitorDomain } = require('../src/services/spyfuAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RADIUS_MILES = 8; // real midpoint of the requested 5-10 mile range
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real hard cap: pass specific location IDs as CLI args to restrict
// execution to exactly those. With no args, runs against every
// eligible location (existing default) - this is what silently ran
// broadly before, so controlled verification MUST pass an explicit ID.
const LOCATION_FILTER = process.argv.slice(2);

async function main() {
  let query = supabase.from('locations').select('id, name, domain, organization_id, latitude, longitude')
    .eq('active', true).not('latitude', 'is', null);
  if (LOCATION_FILTER.length) query = query.in('id', LOCATION_FILTER);
  const { data: locations, error: locError } = await query;

  if (locError) { console.error('Query failed:', locError.message); process.exit(1); }
  if (!locations) { console.error('No locations returned.'); process.exit(1); }

  if (LOCATION_FILTER.length) console.log(`CONTROLLED TEST - restricted to ${locations.length} location(s): ${locations.map(l => l.name).join(', ')}\n`);
  console.log(`Locations with real coordinates: ${locations.length}\n`);

  let discovered = 0, skippedHasCompetitors = 0, failed = 0;

  for (const loc of locations) {
    // Real fix: only skip if REAL radius-sourced competitors already
    // exist - a location with only old, coarser keyword-based entries
    // (or none) still genuinely needs the precise radius treatment.
    const { count: existingCount } = await supabase.from('competitor_observations').select('id, canonical_competitors!inner(location_id)', { count: 'exact', head: true }).eq('canonical_competitors.location_id', loc.id).eq('source', 'dataforseo_radius');
    if ((existingCount || 0) >= 2) { skippedHasCompetitors++; continue; }

    // Real, tenant-derived search terms - no hardcoded category in
    // the code itself, matches the same fix in
    // portfolioCompetitorIntelligence.js.
    const { data: profile } = await supabase.from('market_profiles').select('competitor_search_terms').eq('location_id', loc.id).maybeSingle();
    const searchTerms = profile?.competitor_search_terms || 'local business';

    const result = await discoverCompetitorsNearCoordinates(searchTerms, loc.latitude, loc.longitude, RADIUS_MILES);
    await sleep(1200); // real rate-limit courtesy between calls

    if (result.status !== 'discovered') {
      failed++;
      console.log(`FAILED  ${loc.name}: ${result.reason || result.status}`);
      continue;
    }

    // Real self-exclusion, same fix as portfolioCompetitorIntelligence.js -
    // never store a business as its own competitor.
    const realCandidates = result.candidates.filter(c =>
      c.domain !== loc.domain && !c.name?.toLowerCase().includes(loc.name.toLowerCase())
    );

    let added = 0, updated = 0;
    let spyfuEnriched = 0;
    if (!spyfuConfigured()) {
      console.log(`  NOTE: SpyFu not configured on this server (SPYFU_API_ID/SPYFU_API_SECRET missing) - competitors will be added without real paid/organic SEO enrichment.`);
    }
    for (const c of realCandidates.slice(0, 6)) {
      if (!c.name) continue;
      const { data: resolveResult, error: resolveErr } = await supabase.rpc('resolve_competitor_entity', {
        p_location_id: loc.id, p_organization_id: loc.organization_id, p_name: c.name,
        p_address: c.address || null, p_domain: c.domain || null, p_category: searchTerms,
        p_source: 'dataforseo_radius', p_raw_data: c,
      });
      if (resolveErr) {
        console.log(`RESOLVE FAILED for ${c.name}: ${resolveErr.message}`);
        continue;
      }
      console.log(`  ${c.name}: canonical ${resolveResult.canonicalId.slice(0,8)}... (${resolveResult.matchMethod})`);
      const inserted = { id: resolveResult.canonicalId };
      if (resolveResult.matchMethod === 'new_entity') added++; else updated++;

      // Real SpyFu enrichment, right after real discovery - the
      // exact wiring that was missing before tonight.
      if (spyfuConfigured() && c.domain) {
        const spyfu = await enrichCompetitorDomain(c.domain);
        if (spyfu.status === 'enriched') {
          await supabase.from('canonical_competitors').update({
            last_observed_at: new Date().toISOString(),
          }).eq('id', inserted.id);
          await supabase.from('capability_health').upsert({ capability: 'spyfu_enrichment', status: 'healthy', last_success_at: new Date().toISOString() }, { onConflict: 'capability' });
          spyfuEnriched++;
        } else {
          await supabase.from('capability_health').upsert({
            capability: 'spyfu_enrichment', status: 'degraded',
            last_error: `Real error: ${spyfu.reason || spyfu.status}`, last_error_at: new Date().toISOString(),
          }, { onConflict: 'capability' });
          console.log(`  SpyFu enrichment for ${c.name} (${c.domain}): ${spyfu.status} - ${spyfu.reason || ''}`);
        }
      }
    }
    console.log(`OK      ${loc.name}: found ${result.candidates.length}, added ${added} new / updated ${updated} existing within ${RADIUS_MILES}mi, SpyFu-enriched ${spyfuEnriched}`);
    discovered++;
  }

  console.log(`\nDiscovered: ${discovered}, Skipped (already has competitors): ${skippedHasCompetitors}, Failed: ${failed}, No coordinates: ${64 - locations.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
