#!/usr/bin/env node
/**
 * Single-location, single-call self-enrichment - closes the
 * "own domain never enriched" gap safely. NOT portfolio-wide.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { enrichCompetitorDomain } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOCATION_ID = process.argv[2] || '40000000-0000-0000-0000-000000000004';

async function main() {
  const { data: loc, error } = await supabase.from('locations').select('id, name, domain, organization_id').eq('id', LOCATION_ID).single();
  if (error || !loc) { console.error('Location not found:', error?.message); process.exit(1); }
  if (!loc.domain) { console.error(`${loc.name} has no domain on file - cannot enrich.`); process.exit(1); }

  console.log(`Enriching ${loc.name}'s own domain: ${loc.domain}`);
  const result = await enrichCompetitorDomain(loc.domain);
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'enriched') { console.error('Enrichment failed, nothing written.'); process.exit(1); }

  // Store as a real competitor row representing "self" - lets
  // get_where_you_stand find it via domain match, same pattern
  // already used there.
  const { data: existing } = await supabase.from('competitors').select('id').eq('location_id', LOCATION_ID).eq('domain', loc.domain).maybeSingle();
  if (existing) {
    await supabase.from('competitors').update({ seo_visibility_data: result.seoVisibilityData, provider_enriched_at: result.observedAt }).eq('id', existing.id);
  } else {
    await supabase.from('competitors').insert({
      organization_id: loc.organization_id, location_id: LOCATION_ID, name: loc.name, domain: loc.domain,
      category: 'self', status: 'admin_added', confidence: 'observed', source: 'dataforseo',
      seo_visibility_data: result.seoVisibilityData, provider_enriched_at: result.observedAt,
    });
  }
  console.log('Stored.');
}
main().catch((e) => { console.error(e); process.exit(1); });
