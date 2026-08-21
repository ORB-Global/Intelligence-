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

// Real hard cap for the controlled test: pass specific location IDs
// as CLI args, e.g. `node portfolioCompetitorIntelligence.js <id1> <id2> <id3>`.
// With no args, runs portfolio-wide (unchanged default behavior).
const LOCATION_FILTER = process.argv.slice(2);
let realApiCallCount = 0;

async function main() {
  if (!isConfigured()) { console.log('DataForSEO not configured.'); process.exit(0); }

  let query = supabase.from('locations').select('id, name, organization_id').eq('active', true);
  if (LOCATION_FILTER.length) query = query.in('id', LOCATION_FILTER);
  const { data: locations } = await query;

  if (LOCATION_FILTER.length) console.log(`CONTROLLED TEST - restricted to ${locations.length} location(s): ${locations.map(l => l.name).join(', ')}\n`);

  let discovered = 0, enriched = 0, skippedCached = 0, failed = 0;

  for (const loc of locations) {
    const { data: profile } = await supabase.from('market_profiles').select('primary_market, competitor_search_terms').eq('location_id', loc.id).maybeSingle();
    const { data: existingCompetitors } = await supabase.from('competitors').select('id, domain, provider_enriched_at, category').eq('location_id', loc.id);

    // Real, tenant-derived query - no BoxDrop-specific string in the
    // code itself. Falls back to a generic term only when the tenant
    // genuinely has no category on file, never assumes furniture.
    const searchTerms = profile?.competitor_search_terms || 'local business';

    // Controlled-test only: self-enrich this location's own domain
    // too, so Where You Stand has real data on both sides to compare
    // - not just competitor data.
    if (LOCATION_FILTER.length) {
      const { data: locFull } = await supabase.from('locations').select('domain').eq('id', loc.id).maybeSingle();
      if (locFull?.domain) {
        const { data: selfRow } = await supabase.from('competitors').select('id, provider_enriched_at').eq('location_id', loc.id).eq('category', 'self').maybeSingle();
        const selfIsFresh = selfRow?.provider_enriched_at && (Date.now() - new Date(selfRow.provider_enriched_at).getTime()) < 86400000; // 1 day, tight for this debug cycle
        if (!selfIsFresh) {
        const selfResult = await enrichCompetitorDomain(locFull.domain);
        realApiCallCount++;
        if (selfResult.status === 'enriched') {
          if (selfRow) {
            await supabase.from('competitors').update({ seo_visibility_data: selfResult.seoVisibilityData, provider_enriched_at: selfResult.observedAt }).eq('id', selfRow.id);
          } else {
            await supabase.from('competitors').insert({
              organization_id: loc.organization_id, location_id: loc.id, name: loc.name, domain: locFull.domain,
              category: 'self', status: 'admin_added', confidence: 'observed', source: 'dataforseo',
              seo_visibility_data: selfResult.seoVisibilityData, provider_enriched_at: selfResult.observedAt,
            });
          }
        }
        } else {
          console.log(`[debug] ${loc.name}: self-enrichment skipped, already fresh`);
        }
      }
    }

    // Discover only if no REAL competitors exist yet - explicitly
    // excludes the self-listing row, which should never count as a
    // competitor and would otherwise silently block discovery on any
    // run after the first self-enrichment.
    const realExistingCompetitors = (existingCompetitors || []).filter(c => c.category !== 'self');
    console.log(`[debug] ${loc.name}: existingCompetitors=${existingCompetitors?.length} (real, non-self=${realExistingCompetitors.length}), primary_market=${JSON.stringify(profile?.primary_market)}`);
    if (realExistingCompetitors.length === 0 && profile?.primary_market) {
      const result = await discoverLocalCompetitors(`${searchTerms} near ${profile.primary_market}`);
      realApiCallCount++;
      if (result.status === 'discovered') {
        console.log(`[debug] ${loc.name}: raw candidates =`, JSON.stringify(result.candidates));
        const { data: locDomainRow } = await supabase.from('locations').select('domain').eq('id', loc.id).maybeSingle();
        const ownDomain = locDomainRow?.domain;
        // Real gap found and fixed: exact domain match alone missed
        // a real case where the same business uses a different
        // domain in Maps data than what's on file (BoxDrop Temple:
        // bdtemple.com in Maps vs boxdroptemple.com on file). Also
        // exclude by name similarity - generic (checks whether the
        // location's own name appears in the candidate's name), not
        // a hardcoded BoxDrop string.
        const realCandidates = result.candidates.filter(c =>
          c.domain && c.domain !== ownDomain &&
          !c.name?.toLowerCase().includes(loc.name.toLowerCase())
        );
        for (const c of realCandidates.slice(0, 3)) {
          const { error: insertErr } = await supabase.from('competitors').insert({
            organization_id: loc.organization_id, location_id: loc.id, name: c.name, domain: c.domain,
            category: profile?.competitor_search_terms || 'local business', status: 'auto_discovered', confidence: 'estimated', source: 'dataforseo',
          });
          if (insertErr) {
            console.log(`[debug] ${loc.name}: INSERT FAILED for ${c.name}: ${insertErr.message}`);
          } else {
            discovered++;
          }
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
      realApiCallCount++;
      if (result.status !== 'enriched') { failed++; continue; }
      await supabase.from('competitors').update({ seo_visibility_data: result.seoVisibilityData, provider_enriched_at: result.observedAt }).eq('id', c.id);
      await supabase.from('competitor_observations').insert({
        competitor_id: c.id, observation_type: 'search_visibility',
        observed_value: JSON.stringify(result.seoVisibilityData),
        description: 'Automated DataForSEO enrichment - organic search visibility snapshot.',
        source: 'dataforseo', confidence: 'observed', observed_at: result.observedAt,
      });
      // Real keyword-level detail, no longer discarded - deleted and
      // reinserted fresh each enrichment so stale ranks don't linger.
      if (result.allKeywords?.length) {
        await supabase.from('competitor_keywords').delete().eq('competitor_id', c.id);
        await supabase.from('competitor_keywords').insert(
          result.allKeywords.filter(k => k.keyword).map(k => ({
            organization_id: loc.organization_id, location_id: loc.id, competitor_id: c.id,
            keyword: k.keyword, position: k.position || null, search_volume: k.searchVolume || null,
            observed_at: result.observedAt,
          }))
        );
      }
      enriched++;
    }
  }
  console.log(`Discovered: ${discovered}, Enriched: ${enriched}, Skipped (cached): ${skippedCached}, Failed: ${failed}`);
  console.log(`Real DataForSEO API calls made: ${realApiCallCount} (per-call cost not exposed in API responses - check your DataForSEO dashboard for actual billing)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
