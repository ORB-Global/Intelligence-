#!/usr/bin/env node
/**
 * scripts/testDataForSeoOneLocation.js
 *
 * Phase A validation, per the master brief: test ONE location only
 * before any portfolio-wide calls. Prints the real result for manual
 * verification - does NOT write to the database. Run this first,
 * confirm the output looks right, then a separate write-enabled
 * script is the next step.
 */
require('dotenv').config();
const { isConfigured, enrichCompetitorDomain } = require('../src/services/dataForSeoAdapter');

const TEST_DOMAIN = process.argv[2] || 'mattressfirm.com'; // real Easley competitor domain on file

async function main() {
  if (!isConfigured()) {
    console.log('DATAFORSEO_LOGIN and/or DATAFORSEO_PASSWORD are not set in .env - nothing to do.');
    process.exit(0);
  }
  console.log(`Testing DataForSEO against real domain: ${TEST_DOMAIN}\n`);
  const result = await enrichCompetitorDomain(TEST_DOMAIN);
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error('Fatal error:', e); process.exit(1); });
