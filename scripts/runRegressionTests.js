#!/usr/bin/env node
/**
 * scripts/runRegressionTests.js
 *
 * Real, automated regression test suite - run after any change to a
 * reasoning function, and ideally as part of every deploy. Built
 * directly in response to a real regression tonight (furniture/
 * mattress territory data got silently swapped by an alphabetical-
 * sort bug) - this exists so that class of mistake cannot happen
 * again undetected.
 *
 * Exits with a non-zero code if any test fails, so it can gate a
 * real deploy pipeline (e.g. `node scripts/runRegressionTests.js && pm2 restart ...`).
 *
 * Usage:
 *   node scripts/runRegressionTests.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Running real regression tests...\n');
  const { data: result, error } = await supabase.rpc('run_regression_tests');
  if (error) {
    console.error('FATAL: could not run regression tests:', error.message);
    process.exit(1);
  }

  for (const t of result.results) {
    console.log(`${t.pass ? 'PASS' : 'FAIL'}  ${t.test}${t.pass ? '' : ` - ${t.detail}`}`);
  }

  console.log(`\n${result.passed}/${result.totalTests} real tests passed.`);
  if (!result.allPassed) {
    console.error('\nREGRESSION DETECTED - do not deploy. Review the failed test(s) above before proceeding.');
    process.exit(1);
  }
  console.log('All real regression tests passed.');
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
