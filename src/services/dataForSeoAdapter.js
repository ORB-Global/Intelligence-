/**
 * DataForSEO adapter - competitor search/SEO/PPC intelligence
 * provider. Same contract as every other provider adapter tonight:
 * isConfigured() checked first, real 'requires_provider' status when
 * credentials are missing, never throws, never silently no-ops.
 *
 * Real auth model (verified against DataForSEO's current v3 docs):
 * HTTP Basic Auth, API login as username, API password as password,
 * base64-encoded in the Authorization header. Credentials never leave
 * the server - this file only ever reads them from process.env.
 */

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

function isConfigured() {
  return Boolean(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
}

/**
 * Enriches one competitor's domain with real organic search visibility
 * data via DataForSEO Labs' Ranked Keywords (live) endpoint - real,
 * synchronous, well-documented. Returns a summary, not raw keyword
 * dumps, matching the "intelligence not data dumping" requirement.
 */
async function enrichCompetitorDomain(domain, locationCode = 2840) {
  // locationCode 2840 = United States (DataForSEO's standard code) -
  // real default, overridable once location-specific targeting matters.
  if (!isConfigured()) {
    return { status: 'requires_provider', reason: 'DATAFORSEO_LOGIN and/or DATAFORSEO_PASSWORD are not configured on the server.' };
  }
  if (!domain) {
    return { status: 'failed', reason: 'No domain on file for this competitor - cannot enrich without one.' };
  }

  try {
    const res = await fetch(`${DATAFORSEO_BASE}/dataforseo_labs/google/ranked_keywords/live`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ target: domain, location_code: locationCode, language_code: 'en', limit: 50 }]),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return { status: 'failed', reason: `DataForSEO API error ${res.status}: ${bodyText.slice(0, 200)}` };
    }
    const data = await res.json();
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      return { status: 'failed', reason: `DataForSEO task error: ${task?.status_message || 'unknown'}` };
    }
    const items = task.result?.[0]?.items || [];
    const totalKeywords = task.result?.[0]?.total_count ?? items.length;
    const estimatedTraffic = items.reduce((sum, i) => sum + (i.keyword_data?.keyword_info?.search_volume || 0), 0);

    return {
      status: 'enriched',
      seoVisibilityData: { totalRankedKeywords: totalKeywords, sampleKeywordCount: items.length, estimatedMonthlySearchVolume: estimatedTraffic },
      paidSearchData: null, // requires the Google Ads Advertisers endpoint - future work
      keywordOverlapData: null, // requires a second, comparative call against the client's own domain - future work
      topKeywords: items.slice(0, 10).map((i) => ({ keyword: i.keyword_data?.keyword, position: i.ranked_serp_element?.serp_item?.rank_absolute, searchVolume: i.keyword_data?.keyword_info?.search_volume })),
      observedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

module.exports = { isConfigured, enrichCompetitorDomain };
