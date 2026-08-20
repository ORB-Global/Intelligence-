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
const SPYFU_BASE = 'https://www.spyfu.com/apis';

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
    return { status: 'failed', reason: err.message };
  }
}

module.exports = { isConfigured, enrichCompetitorDomain };
