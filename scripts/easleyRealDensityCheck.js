#!/usr/bin/env node
/**
 * One-off, explicit override: discover real nearby competitors for
 * Easley regardless of the existing 2 already tracked - this is a
 * deliberate exception to get a real "how saturated is this market"
 * number, not a bug. Does NOT delete the existing 2 real competitors;
 * only adds genuinely new, real, distinct ones found nearby.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { discoverCompetitorsNearCoordinates } = require('../src/services/dataForSeoAdapter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EASLEY_ID = '40000000-0000-0000-0000-000000000004';

async function main() {
  const { data: loc } = await supabase.from('locations').select('name, latitude, longitude, domain').eq('id', EASLEY_ID).single();
  const { data: existing } = await supabase.from('competitors').select('name, domain').eq('location_id', EASLEY_ID);
  console.log(`Existing real competitors already tracked: ${existing.map(e => e.name).join(', ')}\n`);

  const result = await discoverCompetitorsNearCoordinates('mattress and furniture store', loc.latitude, loc.longitude, 8);
  if (result.status !== 'discovered') { console.log('FAILED:', result.reason || result.status); process.exit(1); }

  console.log(`Real candidates found within 8mi: ${result.candidates.length}\n`);
  const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
  const existingDomains = new Set(existing.map(e => e.domain).filter(Boolean));
  let added = 0;

  for (const c of result.candidates) {
    console.log(`  - ${c.name} (${c.domain || 'no domain'}) - ${c.address}`);
    const isSelf = c.domain === loc.domain || c.name?.toLowerCase().includes(loc.name.toLowerCase());
    const isDuplicate = existingNames.has(c.name?.toLowerCase()) || (c.domain && existingDomains.has(c.domain));
    if (isSelf || isDuplicate) { console.log(`    (skipped - ${isSelf ? 'self' : 'already tracked'})`); continue; }

    const { data: locFull } = await supabase.from('locations').select('organization_id').eq('id', EASLEY_ID).single();
    const { error } = await supabase.from('competitors').insert({
      organization_id: locFull.organization_id, location_id: EASLEY_ID, name: c.name, domain: c.domain || null,
      address: c.address || null, category: 'mattress and furniture store', status: 'auto_discovered',
      confidence: 'estimated', source: 'dataforseo_radius',
    });
    if (error) { console.log(`    INSERT FAILED: ${error.message}`); continue; }
    added++;
  }

  const { data: finalCount } = await supabase.from('competitors').select('id', { count: 'exact', head: false }).eq('location_id', EASLEY_ID);
  console.log(`\nReal, newly added: ${added}. Total real competitors now tracked for Easley: ${finalCount.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
