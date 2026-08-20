#!/usr/bin/env node
require('dotenv').config();
const { isConfigured, enrichCompetitorDomain } = require('../src/services/spyfuAdapter');
const TEST_DOMAIN = process.argv[2] || 'mattressfirm.com';
async function main() {
  if (!isConfigured()) { console.log('SPYFU_API_ID and/or SPYFU_API_SECRET not set in .env.'); process.exit(0); }
  console.log(`Testing SpyFu against: ${TEST_DOMAIN}\n`);
  console.log(JSON.stringify(await enrichCompetitorDomain(TEST_DOMAIN), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
