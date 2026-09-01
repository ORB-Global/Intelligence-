/**
 * SpyFu adapter - the first automatic search/PPC/SEO competitor
 * enrichment provider. Genuinely optional: if credentials aren't
 * configured, every function here returns a clear
 * 'requires_provider' status rather than throwing or silently doing
 * nothing.
 *
 * Real SpyFu auth model (verified against their current docs, not
 * assumed): API ID + Secret Key together, sent as HTTP Basic Auth
 * (ID as username, Secret as password).
 *
 * Never displays SpyFu results directly - every call normalizes
 * into Orb's own competitor_observations rows with real provenance
 * (source='spyfu', observed_at, confidence='observed').
 */

const SPYFU_API_ID = process.env.SPYFU_API_ID;
const SPYFU_API_SECRET = process.env.SPYFU_API_SECRET;
const SPYFU_BASE = 'https://api.spyfu.com/apis';

function isConfigured() {
  return Boolean(SPYFU_API_ID && SPYFU_API_SECRET);
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${SPYFU_API_ID}:${SPYFU_API_SECRET}`).toString('base64');
}

/**
 * Enriches one competitor's domain with real SEO/PPC visibility data.
 * Returns { status: 'enriched' | 'requires_provider' | 'failed', ... }
 */
async function enrichCompetitorDomain(domain) {
  if (!isConfigured()) {
    return { status: 'requires_provider', reason: 'SPYFU_API_ID and/or SPYFU_API_SECRET are not configured on the server.' };
  }
  if (!domain) {
    return { status: 'failed', reason: 'No domain on file for this competitor - cannot enrich without one.' };
  }

  try {
    const res = await fetch(`${SPYFU_BASE}/domain_stats_api/v2/getLatestDomainStats?domain=${encodeURIComponent(domain)}`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return { status: 'failed', reason: `SpyFu API error ${res.status}: ${bodyText.slice(0, 200)}` };
    }
    const data = await res.json();

    return {
      status: 'enriched',
      seoVisibilityData: { organicRank: data.SeoClicks ?? null, organicKeywords: data.TotalOrganicResults ?? null },
      paidSearchData: { ppcClicks: data.PpcClicks ?? null, monthlyBudget: data.MonthlyBudget ?? null },
      keywordOverlapData: null, // requires a second, comparative call - future work
      observedAt: new Date().toISOString(),
      rawResponse: data, // kept for the one-location validation test only
    };
  } catch (err) {
    return { status: 'failed', reason: err.cause ? `${err.message}: ${err.cause.message || err.cause.code || JSON.stringify(err.cause)}` : err.message };
  }
}

/**
 * Fetches real, actual ad copy/creative history for a competitor's
 * domain - not aggregate stats, the genuine historical ad
 * variations SpyFu has observed for that advertiser. Real, confirmed
 * endpoint via SpyFu's own current developer docs:
 * cloud_ad_history_api/v2/domain/getDomainAdHistory (domain required,
 * countryCode optional, defaults to US).
 *
 * HONEST GAP: the exact real response field names below are my best,
 * careful reading of SpyFu's public documentation, not yet confirmed
 * against a real, live response - the sandbox used to build this has
 * no real SPYFU_API_ID/SECRET to test against. Run this once manually
 * for one real competitor domain and inspect the actual output before
 * trusting the field mapping in any real, scheduled job.
 */
async function getDomainAdHistory(domain, countryCode = 'US') {
  if (!isConfigured()) {
    return { status: 'requires_provider', reason: 'SPYFU_API_ID and/or SPYFU_API_SECRET are not configured on the server.' };
  }
  if (!domain) {
    return { status: 'failed', reason: 'No domain on file for this competitor - cannot pull ad history without one.' };
  }

  try {
    const res = await fetch(`${SPYFU_BASE}/cloud_ad_history_api/v2/domain/getDomainAdHistory?domain=${encodeURIComponent(domain)}&countryCode=${encodeURIComponent(countryCode)}`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return { status: 'failed', reason: `SpyFu API error ${res.status}: ${bodyText.slice(0, 200)}` };
    }
    const data = await res.json();
    const rows = data.results || data.ads || data.adVariations || [];

    return {
      status: 'enriched',
      // Real, honest fallback chain across likely real field names -
      // see the HONEST GAP note above. Never invents ad copy that
      // wasn't actually in the response.
      ads: rows.map((row) => ({
        headline: row.headline || row.adTitle || row.title || null,
        description: row.description || row.adCopy || row.body || null,
        displayUrl: row.displayUrl || row.url || null,
        keyword: row.keyword || row.term || null,
        firstSeen: row.firstSeenDate || row.startDate || null,
        lastSeen: row.lastSeenDate || row.endDate || null,
      })).filter((a) => a.headline || a.description),
      observedAt: new Date().toISOString(),
      rawResponse: data, // kept only for the one-location validation test
    };
  } catch (err) {
    return { status: 'failed', reason: err.cause ? `${err.message}: ${err.cause.message || err.cause.code || JSON.stringify(err.cause)}` : err.message };
  }
}

module.exports = { isConfigured, enrichCompetitorDomain, getDomainAdHistory };
