#!/usr/bin/env node
/**
 * Extracts real, verified address data from each location's GBP
 * connection (already ingested via Oviond, discarded until now) and
 * writes it into locations.address/city/state/zip - the canonical
 * identity source, per the master build directive.
 *
 * Real, not inferred: parses the GBP profile.locations[].description
 * string Oviond already returns (e.g. "85 Ledge Rd, Seabrook, 03874"),
 * never guesses. Locations without a real GBP-sourced address are
 * left untouched and reported, not filled with a guess.
 *
 * --dry-run prints what WOULD be written without writing.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OVIOND_API_KEY = process.env.OVIOND_API_KEY;
const OVIOND_BASE = 'https://api.oviond.com';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY_RUN = process.argv.includes('--dry-run');

async function oviondFetch(path) {
  const res = await fetch(`${OVIOND_BASE}${path}`, { headers: { Authorization: `Bearer ${OVIOND_API_KEY}` } });
  return res.json();
}

// "85 Ledge Rd, Seabrook, 03874" -> { street, city, zip }. Real,
// simple, honest parsing - a US street-city-zip pattern, nothing
// inferred beyond what the string actually contains. State is often
// absent from this GBP description field (confirmed from the real
// sample) - left null rather than guessed.
function parseGbpAddress(description) {
  if (!description) return null;
  const parts = description.split(',').map((s) => s.trim());
  if (parts.length < 2) return null;
  const zipMatch = parts[parts.length - 1].match(/\d{5}/);
  return {
    street: parts[0] || null,
    city: parts.length >= 3 ? parts[1] : (zipMatch ? null : parts[1]),
    zip: zipMatch ? zipMatch[0] : null,
  };
}

async function main() {
  const { data: locations } = await supabase.from('locations').select('id, name, oviond_client_id, city, state, zip, address').eq('active', true);
  let resolved = 0, skipped = 0, alreadyHad = 0;

  for (const loc of locations) {
    if (loc.city && loc.zip) { alreadyHad++; continue; }
    if (!loc.oviond_client_id) { skipped++; continue; }

    const client = await oviondFetch(`/v1/clients/${loc.oviond_client_id}`);
    const gmb = (client.datasources || []).find((d) => d.datasource_id === 'gmb');
    const desc = gmb?.profile?.locations?.[0]?.description;
    const parsed = parseGbpAddress(desc);

    if (!parsed) { skipped++; console.log(`SKIP    ${loc.name} - no GBP address available`); continue; }

    console.log(`${DRY_RUN ? 'WOULD SET' : 'SET'}     ${loc.name}: ${JSON.stringify(parsed)}`);
    if (!DRY_RUN) {
      await supabase.from('locations').update({ address: parsed.street, city: parsed.city, zip: parsed.zip }).eq('id', loc.id);
    }
    resolved++;
  }
  console.log(`\nResolved: ${resolved}, Already had identity: ${alreadyHad}, Skipped (no GBP address): ${skipped}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
