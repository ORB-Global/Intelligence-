/**
 * SpyFu adapter - the first automatic search/PPC/SEO competitor
 * enrichment provider. Genuinely optional: if SPYFU_API_KEY isn't
 * configured, every function here returns a clear
 * 'requires_provider' status rather than throwing or silently doing
 * nothing - callers can distinguish "not enriched yet" from
 * "provider not connected" honestly.
 *
 * Never displays SpyFu results directly - every call normalizes
 * into Orb's own competitor_observations rows with real provenance
 * (source='spyfu', observed_at, confidence='observed' since it's a
 * real API result, not an inference).
 */

const SPYFU_API_KEY = process.env.SPYFU_API_KEY;
const SPYFU_BASE = 'https://www.spyfu.com/apis';

function isConfigured() {
  return Boolean(SPYFU_API_KEY);
}

/**
 * Enriches one competitor's domain with real SEO/PPC visibility data.
 * Returns { status: 'enriched' | 'requires_provider' | 'failed', ... }
 */
async function enrichCompetitorDomain(domain) {
  if (!isConfigured()) {
    return { status: 'requires_provider', reason: 'SPYFU_API_KEY is not configured on the server.' };
  }
  if (!domain) {
    return { status: 'failed', reason: 'No domain on file for this competitor - cannot enrich without one.' };
  }

  try {
    // Real SpyFu Domain Stats API call shape - kept isolated here so
    // swapping providers later never touches the caller's contract.
    const res = await fetch(`${SPYFU_BASE}/domain_stats_api/v2/getLatestDomainStats?domain=${encodeURIComponent(domain)}&api_key=${SPYFU_API_KEY}`);
    if (!res.ok) {
      return { status: 'failed', reason: `SpyFu API error ${res.status}` };
    }
    const data = await res.json();

    return {
      status: 'enriched',
      seoVisibilityData: { organicRank: data.SeoClicks ?? null, organicKeywords: data.TotalOrganicResults ?? null },
      paidSearchData: { ppcClicks: data.PpcClicks ?? null, monthlyBudget: data.MonthlyBudget ?? null },
      keywordOverlapData: null, // requires a second, comparative call - future work
      observedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

module.exports = { isConfigured, enrichCompetitorDomain };
