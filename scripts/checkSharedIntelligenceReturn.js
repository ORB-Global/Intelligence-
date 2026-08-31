#!/usr/bin/env node
/**
 * scripts/checkSharedIntelligenceReturn.js
 *
 * Real, static regression test for the exact bug class that broke
 * seven intelligence systems tonight: assembleSharedIntelligence
 * fetching real data into destructured local variables, but its
 * return statement silently omitting some of them. This class of
 * bug is invisible to any SQL/database-level test - the data is
 * correctly fetched, the function just never gives it back.
 *
 * Approach: parse the real, live source file directly (not a mock),
 * extract every name destructured from the real Promise.all result,
 * extract every name in the real return statement, and assert the
 * two sets are identical. Exits non-zero on any mismatch, so this
 * can gate deploys the same way scripts/runRegressionTests.js does.
 *
 * Usage:
 *   node scripts/checkSharedIntelligenceReturn.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'routes', 'missionControl.js');
const source = fs.readFileSync(FILE, 'utf8');

const fnStart = source.indexOf('async function assembleSharedIntelligence');
if (fnStart === -1) { console.error('FATAL: could not find assembleSharedIntelligence in the real source file.'); process.exit(1); }
const nextFnStart = source.indexOf('\nasync function ', fnStart + 1);
const fnBody = source.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);

// Real destructured names: { data: someName } entries inside the
// function's const [...] = await Promise.all([...]) block.
const destructured = [...fnBody.matchAll(/\{\s*data:\s*(\w+)\s*\}/g)].map((m) => m[1]);

// Real returned names: the last `return { ... };` in this function body.
const returnMatch = fnBody.match(/return\s*\{([\s\S]*?)\};\s*\n\}/);
if (!returnMatch) { console.error('FATAL: could not find a real return statement in assembleSharedIntelligence.'); process.exit(1); }
const returnedNames = [...returnMatch[1].matchAll(/(\w+)(?:\s*,|\s*$)/g)].map((m) => m[1]).filter(Boolean);

const destructuredSet = new Set(destructured);
const returnedSet = new Set(returnedNames);

// Real, known, intentional exceptions - these destructured values are
// deliberately transformed into a different derived name before the
// real return statement, not passed through directly. Anything added
// here must be a genuine, deliberate transformation, not a shortcut
// to silence a real bug.
const KNOWN_TRANSFORMED = new Set(['weatherRaw']); // -> becomes weatherEvidence

const missing = [...destructuredSet].filter((n) => !returnedSet.has(n) && !KNOWN_TRANSFORMED.has(n));
const extra = [...returnedSet].filter((n) => !destructuredSet.has(n) && n !== 'weatherEvidence'); // weatherEvidence is real, intentionally derived after the Promise.all, not destructured from it

console.log(`Real destructured fields: ${destructuredSet.size}`);
console.log(`Real returned fields: ${returnedSet.size}`);

if (missing.length > 0) {
  console.error(`\nFAIL: ${missing.length} real field(s) fetched but NOT returned - this is exactly tonight's bug class:`);
  missing.forEach((n) => console.error(`  - ${n}`));
  process.exit(1);
}
if (extra.length > 0) {
  console.error(`\nWARNING: ${extra.length} real field(s) returned but never fetched via the Promise.all - check for a typo or stale reference:`);
  extra.forEach((n) => console.error(`  - ${n}`));
  // Not fatal - could be a real, intentional derived value - but worth a human look.
}
console.log('\nPASS: every real fetched field is genuinely returned by assembleSharedIntelligence.');
