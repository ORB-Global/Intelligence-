#!/usr/bin/env node
/**
 * Portfolio-wide competitor discovery + DataForSEO enrichment.
 * Real caching: skips any competitor enriched within the last 30
 * days - never re-calls the API for fresh-enough data.
 * DataForSEO handles discovery (local Maps SERP) + current ranking
 * enrichment. SpyFu (once verified) supplements with deeper
 * PPC/keyword-gap intelligence - division of responsibility, not
 * duplication.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { isConfigured, enrichCompetitorDomain, discoverLocalCompetitors } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CACHE_DAYS = 30;

async function main() {
  if (!isConfigured()) { console.log('DataForSEO not configured.'); process.exit(0); }

  const { data: locations } = await supabase.from('locations').select('id, name, organization_id').eq('active', true);
  let discovered = 0, enriched = 0, skippedCached = 0, failed = 0;

  for (const loc of locations) {
    const { data: profile } = await supabase.from('market_profiles').select('primary_market').eq('location_id', loc.id).maybeSingle();
    const { data: existingCompetitors } = await supabase.from('competitors').select('id, domain, provider_enriched_at').eq('location_id', loc.id);

    // Discover only if no real competitors exist yet for this location
    if ((!existingCompetitors || existingCompetitors.length === 0) && profile?.primary_market) {
      const result = await discoverLocalCompetitors(`mattress store near ${profile.primary_market}`);
      if (result.status === 'discovered') {
        for (const c of result.candidates.slice(0, 3)) {
          if (!c.domain) continue;
          await supabase.from('competitors').insert({
            organization_id: loc.organization_id, location_id: loc.id, name: c.name, domain: c.domain,
            category: 'Mattress/furniture store', status: 'auto_discovered', confidence: 'medium', source: 'dataforseo',
          });
          discovered++;
        }
      }
    }

    // Enrich - real cache check first
    const { data: toEnrich } = await supabase.from('competitors').select('id, domain, provider_enriched_at').eq('location_id', loc.id).not('domain', 'is', null);
    for (const c of toEnrich || []) {
      if (c.provider_enriched_at && (Date.now() - new Date(c.provider_enriched_at).getTime()) < CACHE_DAYS * 86400000) {
        skippedCached++; continue;
      }
      const result = await enrichCompetitorDomain(c.domain);
      if (result.status !== 'enriched') { failed++; continue; }
      await supabase.from('competitors').update({ seo_visibility_data: result.seoVisibilityData, provider_enriched_at: result.observedAt }).eq('id', c.id);
      await supabase.from('competitor_observations').insert({
        competitor_id: c.id, observation_type: 'search_visibility',
        observed_value: JSON.stringify(result.seoVisibilityData),
        description: 'Automated DataForSEO enrichment - organic search visibility snapshot.',
        source: 'dataforseo', confidence: 'observed', observed_at: result.observedAt,
      });
      enriched++;
    }
  }
  console.log(`Discovered: ${discovered}, Enriched: ${enriched}, Skipped (cached): ${skippedCached}, Failed: ${failed}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
