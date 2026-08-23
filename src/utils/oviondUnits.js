/**
 * Canonical, single-source normalizer for ambiguous Oviond
 * provider-unit fields. Every ingestion script (sync, current-period,
 * backfill) must import and use this rather than converting units
 * ad hoc - that's exactly how the Google spend /1e6 bug happened:
 * two separate scripts each wrote their own (wrong) conversion logic
 * instead of sharing one, tested implementation.
 *
 * Real, confirmed behavior (verified by hand against a real broken
 * value tonight, not assumed): despite the field name 'cost_micros'
 * suggesting Google Ads API's raw micros convention (divide by 1e6),
 * Oviond's real /v1/data/query response for the ACCOUNT/DATE query
 * shape used by our scripts already returns this field in real
 * dollar-scaled units. Real regression case: a raw value of
 * 267.674204 must normalize to 267.674204, NOT 0.000267674204.
 */

/**
 * Normalizes a real Oviond row's spend field for Google (gadw) rows.
 * Prefers a real 'spend' field if present; falls back to 'cost_micros'
 * WITHOUT dividing, per the confirmed real behavior above.
 */
function normalizeGoogleSpend(row) {
  const raw = row.spend ?? row.cost_micros ?? 0;
  return Number(raw) || 0;
}

/**
 * Normalizes a real Oviond row's CPC field for Google (gadw) rows.
 * Same real behavior - 'average_cpc' is already dollar-scaled, no
 * division.
 */
function normalizeGoogleCpc(row) {
  const raw = row.cpc ?? row.average_cpc ?? null;
  return raw !== null ? (Number(raw) || null) : null;
}

module.exports = { normalizeGoogleSpend, normalizeGoogleCpc };
