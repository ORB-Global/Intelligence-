/**
 * Real regression test for the Google spend unit bug found and fixed
 * tonight. Run with: node test/oviondUnits.test.js
 * No test framework dependency - simple assert-and-exit, consistent
 * with this codebase's existing script style.
 */
const assert = require('assert');
const { normalizeGoogleSpend, normalizeGoogleCpc } = require('../src/utils/oviondUnits');

// Real regression case: the exact broken value found tonight in
// production Easley data. Before the fix, this incorrectly produced
// 0.000267674204 (divided by 1e6). Must now produce 267.674204.
assert.strictEqual(normalizeGoogleSpend({ cost_micros: 267.674204 }), 267.674204,
  'REGRESSION: cost_micros must NOT be divided by 1e6 - this is the exact bug found in production tonight.');

// Real case: when a real 'spend' field is directly present (as in
// syncOviondClients.js's proven-working path), it must be preferred.
assert.strictEqual(normalizeGoogleSpend({ spend: 350.57, cost_micros: 999 }), 350.57,
  'spend field must take priority over cost_micros when both are present.');

// Real edge case: no real data present, must not throw or return NaN.
assert.strictEqual(normalizeGoogleSpend({}), 0, 'missing fields must normalize to 0, not NaN or throw.');

// Real CPC cases, same real logic.
assert.strictEqual(normalizeGoogleCpc({ average_cpc: 0.6553 }), 0.6553);
assert.strictEqual(normalizeGoogleCpc({}), null);

console.log('All real regression tests passed.');
