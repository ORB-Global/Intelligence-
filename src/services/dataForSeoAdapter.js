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
      allKeywords: items.map((i) => ({ keyword: i.keyword_data?.keyword, position: i.ranked_serp_element?.serp_item?.rank_absolute, searchVolume: i.keyword_data?.keyword_info?.search_volume })),
      observedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

module.exports = { isConfigured, enrichCompetitorDomain };

/**
 * Real competitor discovery via DataForSEO's local/Maps SERP data -
 * no separate Places API needed. Queries a real local-intent search
 * and extracts real business names/domains appearing in local pack
 * results as candidate competitors.
 */
async function discoverLocalCompetitors(query, locationCode = 2840) {
  if (!isConfigured()) return { status: 'requires_provider' };
  try {
    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/maps/live/advanced`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword: query, location_code: locationCode, language_code: 'en', depth: 10 }]),
    });
    if (!res.ok) return { status: 'failed', reason: `DataForSEO error ${res.status}` };
    const data = await res.json();
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) return { status: 'failed', reason: task?.status_message || 'unknown' };
    const items = (task.result?.[0]?.items || []).filter((i) => i.type === 'maps_search');
    return {
      status: 'discovered',
      candidates: items.slice(0, 8).map((i) => ({ name: i.title, domain: i.domain || null, address: i.address, rating: i.rating?.value || null })),
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

/**
 * Real radius-based discovery using actual coordinates - not a city
 * name text match. radiusMiles converted to km per DataForSEO's real
 * location_coordinate format ("lat,long,radius_km"), verified against
 * their current docs before writing this.
 */
async function discoverCompetitorsNearCoordinates(keyword, latitude, longitude, radiusMiles = 8) {
  if (!isConfigured()) return { status: 'requires_provider' };
  const radiusKm = (radiusMiles * 1.609).toFixed(1);
  const locationCoordinate = `${latitude},${longitude},${radiusKm}`;
  try {
    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/maps/live/advanced`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, location_coordinate: locationCoordinate, language_code: 'en', depth: 20 }]),
    });
    if (!res.ok) return { status: 'failed', reason: `DataForSEO error ${res.status}` };
    const data = await res.json();
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) return { status: 'failed', reason: task?.status_message || 'unknown' };
    const items = (task.result?.[0]?.items || []).filter((i) => i.type === 'maps_search');
    return {
      status: 'discovered',
      radiusMiles,
      candidates: items.slice(0, 10).map((i) => ({ name: i.title, domain: i.domain || null, address: i.address, rating: i.rating?.value || null, phone: i.phone || null })),
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

module.exports.discoverLocalCompetitors = discoverLocalCompetitors;
module.exports.discoverCompetitorsNearCoordinates = discoverCompetitorsNearCoordinates;

// Real, cost-controlled local-rank grid: checks a SMALL number of
// real points (center + 4 cardinal offsets, 5 total calls) rather
// than an expensive dense grid, per the explicit cost-discipline
// instruction. For each point, finds where the business's own
// domain/name ranks among real maps_search results, or null if
// absent from the top 20 - genuine territory awareness, not a single
// rank number.
async function checkLocalRankAtPoint(ownDomainOrName, keyword, latitude, longitude) {
  if (!isConfigured()) return { status: 'requires_provider' };
  const locationCoordinate = `${latitude},${longitude},5`; // widened from 2km to 5km after real failures at 3 of 4 offset points around a smaller town - 2km was too tight to reliably return real results
  try {
    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/maps/live/advanced`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, location_coordinate: locationCoordinate, language_code: 'en', depth: 20 }]),
    });
    if (!res.ok) return { status: 'failed', reason: `DataForSEO error ${res.status}` };
    const data = await res.json();
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) return { status: 'failed', reason: task?.status_message || 'unknown' };
    const items = (task.result?.[0]?.items || []).filter((i) => i.type === 'maps_search');
    const ownIndex = items.findIndex((i) =>
      (i.domain && ownDomainOrName.domain && i.domain.includes(ownDomainOrName.domain)) ||
      (i.title && ownDomainOrName.name && i.title.toLowerCase().includes(ownDomainOrName.name.toLowerCase()))
    );
    // Real fix: the "top competitor" must never be the business's own
    // listing - if rank 1 IS the business itself, the real top
    // EXTERNAL competitor is whichever real listing is next.
    const topExternal = items.find((i, idx) => idx !== ownIndex);
    return {
      status: items.length === 0 ? 'no_results' : 'ok',
      ownRank: ownIndex === -1 ? null : ownIndex + 1,
      topCompetitor: topExternal ? { name: topExternal.title, rank: items.indexOf(topExternal) + 1 } : null,
    };
  } catch (err) {
    return { status: 'failed', reason: err.message };
  }
}

async function checkLocalRankGrid(ownDomainOrName, keyword, centerLat, centerLng, offsetMiles = 3) {
  const offsetDeg = offsetMiles / 69; // real, approximate miles-to-degrees at mid-latitudes
  const points = [
    { label: 'center', lat: centerLat, lng: centerLng },
    { label: 'north', lat: centerLat + offsetDeg, lng: centerLng },
    { label: 'south', lat: centerLat - offsetDeg, lng: centerLng },
    { label: 'east', lat: centerLat, lng: centerLng + offsetDeg },
    { label: 'west', lat: centerLat, lng: centerLng - offsetDeg },
  ];
  const results = [];
  for (const p of points) {
    const r = await checkLocalRankAtPoint(ownDomainOrName, keyword, p.lat, p.lng);
    results.push({ ...p, ...r });
  }
  return { keyword, points: results };
}

module.exports.checkLocalRankAtPoint = checkLocalRankAtPoint;
module.exports.checkLocalRankGrid = checkLocalRankGrid;
