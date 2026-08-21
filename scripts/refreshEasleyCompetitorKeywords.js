#!/usr/bin/env node
/**
 * Exact, minimal, approved scope: re-enrich ONLY Easley's 2 real
 * existing competitors (Mattress Firm, Ashley) to persist real
 * keyword-level data - their aggregate counts were captured before
 * competitor_keywords existed, and have stayed within the 30-day
 * cache since. This is 2 real API calls, nothing more.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { enrichCompetitorDomain } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EASLEY_ID = '40000000-0000-0000-0000-000000000004';

async function main() {
  const { data: location } = await supabase.from('locations').select('organization_id').eq('id', EASLEY_ID).single();
  const { data: competitors } = await supabase.from('competitors').select('id, name, domain')
    .eq('location_id', EASLEY_ID).neq('category', 'self');

  console.log(`Exact scope: ${competitors.length} competitor(s) - ${competitors.map(c => c.name).join(', ')}\n`);
  if (competitors.length !== 2) {
    console.log('STOPPING - expected exactly 2 competitors, scope does not match. No calls made.');
    process.exit(1);
  }

  for (const c of competitors) {
    console.log(`Enriching ${c.name} (${c.domain})...`);
    const result = await enrichCompetitorDomain(c.domain);
    if (result.status !== 'enriched') { console.log(`FAILED: ${result.reason || result.status}`); continue; }

    await supabase.from('competitors').update({ seo_visibility_data: result.seoVisibilityData, provider_enriched_at: result.observedAt }).eq('id', c.id);
    await supabase.from('competitor_keywords').delete().eq('competitor_id', c.id);
    if (result.allKeywords?.length) {
      await supabase.from('competitor_keywords').insert(
        result.allKeywords.filter(k => k.keyword).map(k => ({
          organization_id: location.organization_id, location_id: EASLEY_ID, competitor_id: c.id,
          keyword: k.keyword, position: k.position || null, search_volume: k.searchVolume || null,
          observed_at: result.observedAt,
        }))
      );
    }
    console.log(`  Stored ${result.allKeywords?.length || 0} real keyword rows.`);
  }
  console.log('\nDone. Exactly 2 real API calls made, as scoped.');
}
main().catch((e) => { console.error(e); process.exit(1); });
