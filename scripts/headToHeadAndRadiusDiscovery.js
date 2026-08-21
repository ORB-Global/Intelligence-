#!/usr/bin/env node
/**
 * Real head-to-head keyword comparison (client domain vs a named
 * competitor) + real radius-based competitor discovery via
 * DataForSEO's local Maps SERP. Prints results for review - writes
 * to competitor_observations only after a clean run, since this is
 * exactly the kind of real, comparative evidence the client will see
 * directly, so it needs a human look before it's live.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { enrichCompetitorDomain, discoverLocalCompetitors } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOCATION_ID = process.argv[2] || '40000000-0000-0000-0000-000000000004';

async function main() {
  const { data: loc } = await supabase.from('locations').select('id, name, domain, city, state').eq('id', LOCATION_ID).single();
  console.log(`\n=== Head-to-head: ${loc.name} (${loc.domain}) ===\n`);

  const own = await enrichCompetitorDomain(loc.domain);
  console.log('Your own domain:', JSON.stringify(own, null, 2));

  const { data: competitors } = await supabase.from('competitors').select('id, name, domain, seo_visibility_data').eq('location_id', LOCATION_ID);
  for (const c of competitors || []) {
    console.log(`\n--- ${c.name} (${c.domain}) ---`);
    console.log('Stored:', JSON.stringify(c.seo_visibility_data));
    if (own.status === 'enriched' && c.seo_visibility_data) {
      const diff = c.seo_visibility_data.totalRankedKeywords - own.seoVisibilityData.totalRankedKeywords;
      console.log(`Ranked-keyword gap: ${c.name} has ${diff > 0 ? diff + ' more' : Math.abs(diff) + ' fewer'} ranked keywords than you.`);
    }
  }

  console.log(`\n=== Radius competitor discovery: ${loc.city}, ${loc.state} ===\n`);
  const { data: profile } = await supabase.from('market_profiles').select('competitor_search_terms').eq('location_id', LOCATION_ID).maybeSingle();
  const searchTerms = profile?.competitor_search_terms || 'local business';
  const discovered = await discoverLocalCompetitors(`${searchTerms} near ${loc.city}, ${loc.state}`);
  console.log(JSON.stringify(discovered, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
