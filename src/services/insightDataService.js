/**
 * MERGE NOTE (Priority 1): metrics and connection data now read from
 * the new tenant-scoped schema (organizations/locations/
 * historical_metrics/connection_health) via the legacy_client_id
 * bridge on `locations` - this is the actual "one source of truth"
 * merge, not a parallel system. The external contract (client_id from
 * the URL, ORB_ADMIN_KEY auth) is completely unchanged - admin.html
 * and the existing generate-insight/chat routes don't know or care
 * that the data moved underneath them.
 */

const supabase = require('../config/supabase');

async function resolveLocationId(clientId) {
  const { data, error } = await supabase
    .from('locations')
    .select('id, organization_id')
    .eq('legacy_client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Failed to resolve location for client ${clientId}: ${error.message || 'unknown error'}`);
  if (!data) throw new Error(`Client ${clientId} has no bridged location in the new schema yet.`);
  return data;
}

async function getClientRecord(clientId) {
  const { data, error } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (error) throw new Error(`Failed to fetch client ${clientId}: ${error.message || 'unknown error'}`);
  return data;
}

async function getRecentSnapshots(clientId, limit = 12) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('historical_metrics')
    .select('*')
    .eq('location_id', locationId)
    .order('period_start', { ascending: false });
  if (error) throw new Error(`Failed to fetch metrics for client ${clientId}: ${error.message || 'unknown error'}`);

  const rows = data || [];
  const byPeriod = new Map();
  for (const row of rows) {
    const key = `${row.period_start}_${row.period_end}`;
    if (!byPeriod.has(key)) {
      byPeriod.set(key, { period_start: row.period_start, period_end: row.period_end, ad_spend: 0, impressions: 0, reach: 0, clicks: 0, reported_sales: null });
    }
    const agg = byPeriod.get(key);
    agg.ad_spend += Number(row.ad_spend || 0);
    agg.impressions += Number(row.impressions || 0);
    agg.reach += Number(row.reach || 0);
    agg.clicks += Number(row.clicks || 0);
    if (row.reported_sales) agg.reported_sales = Number(row.reported_sales);
  }
  return Array.from(byPeriod.values())
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))
    .slice(0, limit);
}

async function getExistingInsights(clientId, limit = 5) {
  const { data, error } = await supabase
    .from('insights')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch insights for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getProvenContent(clientId, limit = 20) {
  const { data, error } = await supabase
    .from('proven_content')
    .select('*')
    .eq('client_id', clientId)
    .limit(limit);
  if (error) throw new Error(`Failed to fetch proven_content for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getSurveyResponses(clientId, limit = 20) {
  const { data, error } = await supabase
    .from('survey_responses')
    .select('*')
    .eq('client_id', clientId)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch survey_responses for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getChannelSnapshots(clientId, periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return [];
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('historical_metrics')
    .select('*')
    .eq('location_id', locationId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd);
  if (error) throw new Error(`Failed to fetch channel metrics for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getCurrentAndPreviousPeriods(clientId) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('historical_metrics')
    .select('period_start, period_end')
    .eq('location_id', locationId)
    .order('period_start', { ascending: false });
  if (error) throw new Error(`Failed to fetch periods for client ${clientId}: ${error.message || 'unknown error'}`);

  const rows = data || [];
  const uniquePeriods = [...new Set(rows.map((r) => `${r.period_start}_${r.period_end}`))]
    .map((key) => {
      const [period_start, period_end] = key.split('_');
      return { period_start, period_end };
    })
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

  return { current: uniquePeriods[0] || null, previous: uniquePeriods[1] || null };
}

async function getConnectionHealth(clientId) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('connection_health')
    .select('channel, status, freshness_status, last_successful_sync_at')
    .eq('location_id', locationId);
  if (error) throw new Error(`Failed to fetch connection health for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getAccountNotes(clientId, limit = 10) {
  const { data, error } = await supabase
    .from('account_notes')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch account_notes for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getLatestHealthScore(clientId) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data: score, error: scoreError } = await supabase
    .from('health_scores')
    .select('*')
    .eq('location_id', locationId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (scoreError) throw new Error(`Failed to fetch health score for client ${clientId}: ${scoreError.message || 'unknown error'}`);
  if (!score) return null;

  const { data: factors, error: factorsError } = await supabase
    .from('health_score_factors')
    .select('factor, score, weight, status, explanation')
    .eq('health_score_id', score.id);
  if (factorsError) throw new Error(`Failed to fetch health score factors for client ${clientId}: ${factorsError.message || 'unknown error'}`);

  return { ...score, factors: factors || [] };
}

async function getServicesManaged(clientId) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('services_managed')
    .select('service, status')
    .eq('location_id', locationId);
  if (error) throw new Error(`Failed to fetch services managed for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

async function getIntelligenceFeed(clientId, limit = 20) {
  const { id: locationId } = await resolveLocationId(clientId);
  const { data, error } = await supabase
    .from('intelligence_feed')
    .select('*')
    .eq('location_id', locationId)
    .order('occurred_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch intelligence feed for client ${clientId}: ${error.message || 'unknown error'}`);
  return data || [];
}

module.exports = {
  getClientRecord,
  getRecentSnapshots,
  getExistingInsights,
  getProvenContent,
  getSurveyResponses,
  getChannelSnapshots,
  getCurrentAndPreviousPeriods,
  getConnectionHealth,
  getAccountNotes,
  getLatestHealthScore,
  getServicesManaged,
  getIntelligenceFeed,
  resolveLocationId,
};
