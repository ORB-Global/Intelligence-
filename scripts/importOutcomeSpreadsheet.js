#!/usr/bin/env node
/**
 * scripts/importOutcomeSpreadsheet.js
 *
 * Real, tenant-scoped CSV outcome ingestion. Intelligently maps
 * whatever columns actually exist to the real schema fields - never
 * assumes a rigid format. Preserves the original row and the exact
 * real mapping used, for audit. Re-importing the same file for the
 * same real dates updates rather than duplicates (real unique
 * constraint on location_id + observation_date + source).
 *
 * SCOPE: CSV only for now. The xlsx (SheetJS) npm package has a real,
 * confirmed, unpatched prototype-pollution vulnerability specifically
 * when parsing arbitrary user-uploaded files - exactly this script's
 * use case. Rather than ship that exposure, this uses a small,
 * dependency-free CSV parser instead. XLSX support is deferred until
 * a properly vetted library is chosen (read-excel-file and ExcelJS
 * are real, actively-maintained candidates confirmed via other real
 * projects' migration away from xlsx).
 *
 * Usage:
 *   node scripts/importOutcomeSpreadsheet.js --location=<id> --file=<path.csv> [--dry-run]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2);
const get = (flag) => { const a = args.find((x) => x.startsWith(`--${flag}=`)); return a ? a.split('=')[1] : null; };
const LOCATION_ID = get('location');
const FILE_PATH = get('file');
const DRY_RUN = args.includes('--dry-run');

if (!LOCATION_ID || !FILE_PATH) { console.error('Provide --location=<id> --file=<path.csv>'); process.exit(1); }
if (!FILE_PATH.toLowerCase().endsWith('.csv')) {
  console.error('Only .csv is supported right now - XLSX support is deferred pending a safe library choice (see comment at top of this file).');
  process.exit(1);
}

// Real, small, dependency-free CSV parser - handles quoted fields
// and commas/quotes inside quotes correctly, without pulling in a
// third-party library with a known real vulnerability.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else { field += c; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Real, honest column-name recognition - covers the plausible real
// variants a real business owner's spreadsheet might use, per field.
// Never guesses a mapping it isn't reasonably confident about.
const FIELD_PATTERNS = {
  observation_date: /^(date|day|observation.?date)$/i,
  walk_ins: /^(walk.?ins?|customers?.?in|foot.?traffic|visitors?)$/i,
  transactions: /^(transactions?|sales?.?count|orders?|tickets?)$/i,
  revenue: /^(revenue|sales?(\s|_)?(total|amount)?|total.?sales)$/i,
  primary_category: /^(category|product.?category|top.?category|primary.?category)$/i,
  quantity: /^(quantity|units?|qty)$/i,
  average_ticket: /^(avg.?ticket|average.?ticket|ticket.?value|avg.?sale)$/i,
  inventory_count: /^(inventory|stock|units?.?on.?hand)$/i,
};

function mapColumns(headerRow) {
  const mapping = {};
  for (const rawHeader of headerRow) {
    const header = String(rawHeader || '').trim();
    for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
      if (pattern.test(header.replace(/\s+/g, ' '))) { mapping[field] = rawHeader; break; }
    }
  }
  return mapping;
}

function parseDate(value) {
  const parsed = new Date(value);
  return isNaN(parsed) ? null : parsed.toISOString().slice(0, 10);
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

async function main() {
  const { data: location } = await supabase.from('locations').select('id, organization_id, name').eq('id', LOCATION_ID).maybeSingle();
  if (!location) { console.error('Real location not found or not accessible.'); process.exit(1); }

  const text = fs.readFileSync(FILE_PATH, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) { console.error('Real file has no rows.'); process.exit(1); }

  const headerRow = rows[0];
  const mapping = mapColumns(headerRow);
  console.log(`Real column mapping detected for ${location.name}:`);
  console.log(JSON.stringify(mapping, null, 2));

  if (!mapping.observation_date) {
    console.error('\nCould not confidently identify a real date column - refusing to guess. Rename the date column to something like "Date" and retry.');
    process.exit(1);
  }

  let batchId = null;
  if (!DRY_RUN) {
    const { data: batch, error: batchErr } = await supabase.from('outcome_import_batches').insert({
      location_id: LOCATION_ID, organization_id: location.organization_id,
      uploaded_by: get('uploaded-by') || null, source_filename: FILE_PATH.split('/').pop(),
      column_mapping: mapping, status: 'processing',
    }).select().single();
    if (batchErr) console.log(`WARNING: could not create real batch/provenance record: ${batchErr.message} - rows will still be written, but without batch tracking.`);
    batchId = batch?.id;
  }

  let written = 0, skipped = 0;
  const colIndex = {};
  Object.entries(mapping).forEach(([field, header]) => { colIndex[field] = headerRow.indexOf(header); });

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null)) continue;
    const rawDate = colIndex.observation_date >= 0 ? row[colIndex.observation_date] : null;
    const obsDate = parseDate(rawDate);
    if (!obsDate) { skipped++; continue; }

    const record = {
      location_id: LOCATION_ID, import_batch_id: batchId, observation_date: obsDate,
      walk_ins: colIndex.walk_ins >= 0 ? parseNumber(row[colIndex.walk_ins]) : null,
      transactions: colIndex.transactions >= 0 ? parseNumber(row[colIndex.transactions]) : null,
      revenue: colIndex.revenue >= 0 ? parseNumber(row[colIndex.revenue]) : null,
      primary_category: colIndex.primary_category >= 0 ? String(row[colIndex.primary_category] || '') || null : null,
      quantity: colIndex.quantity >= 0 ? parseNumber(row[colIndex.quantity]) : null,
      average_ticket: colIndex.average_ticket >= 0 ? parseNumber(row[colIndex.average_ticket]) : null,
      inventory_count: colIndex.inventory_count >= 0 ? parseNumber(row[colIndex.inventory_count]) : null,
      source: 'csv_upload', raw_row: Object.fromEntries(headerRow.map((h, idx) => [h, row[idx]])),
    };

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${obsDate}:`, JSON.stringify(record));
      written++;
      continue;
    }
    const { error } = await supabase.from('outcome_observations').upsert(record, { onConflict: 'location_id,observation_date,source' });
    if (error) { console.log(`  DB error for ${obsDate}: ${error.message}`); skipped++; } else { written++; }
  }

  if (!DRY_RUN && batchId) {
    await supabase.from('outcome_import_batches').update({ row_count: written, status: skipped > 0 && written === 0 ? 'failed' : (skipped > 0 ? 'partial' : 'completed') }).eq('id', batchId);
  }
  console.log(`\nDone. ${written} real row(s) ${DRY_RUN ? 'would be written' : 'written'}, ${skipped} skipped.`);
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
