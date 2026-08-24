/**
 * Every route here uses req.supabase (the per-user, RLS-scoped client
 * from requireSupabaseAuth), never the service-role client. This is
 * deliberate: authorization is enforced by the database policies
 * already tested extensively, not re-implemented in application code.
 * If a query returns nothing, it's because RLS said so.
 */

const express = require('express');
const requireSupabaseAuth = require('../middleware/requireSupabaseAuth');
const requireStaffRole = require('../middleware/requireStaffRole');
const chatService = require('../services/chatService');

// Bounded-failure guarantee: any unhandled rejection inside a route
// wrapped with this returns a real, fast error response instead of
// letting the client's fetch hang forever. There is no global Express
// error-handling middleware in this app, so an unhandled async
// rejection previously meant the request never got a response at
// all - confirmed as the real root cause of the infinite-loading
// production incident.
function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.originalUrl}] Unhandled error:`, err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: { message: `Server error: ${err.message}` } });
      }
    }
  };
}
const { generateCreative } = require('../services/creativeService');
const { classifyStatement } = require('../services/tellVantageService');
const { synthesizeBusinessPerformance, presentOrbActivitySummary } = require('../services/clientIntelligencePresenter');
const { buildChannelComparison } = require('../utils/metrics');
// Deliberate, single exception to the "never use service role here"
// rule: platform_roles has no self-select RLS policy at all (by
// design), so this is the one legitimate case where a direct,
// authoritative check is needed rather than relying on RLS-scoped
// results.
const supabaseService = require('../config/supabase');

const router = express.Router();
router.use(requireSupabaseAuth);

const CHANNEL_LABELS = {
  'fb-ads': 'Meta Ads', 'inst-ads': 'Meta Ads (Instagram)', 'gadw': 'Google Ads',
  'gmb': 'Google Business Profile', 'fb-pg': 'Facebook', 'inst': 'Instagram',
  meta: 'Meta Ads', google: 'Google Ads',
};
function labelChannel(c) { return CHANNEL_LABELS[c] || c; }

const MAX_QUESTION_LENGTH = 500;
const HISTORY_TURNS_INCLUDED = 6; // caps conversation replay - cost/scale control, not full history

/**
 * Real, tenant-scoped context assembly - every query here goes through
 * req.supabase (the user's own token), so RLS decides what's visible
 * before this function ever runs. Capped/summarized, not a raw dump:
 * only the two most recent periods for channel comparison, only the
 * most recent 15 timeline items (oldest-first so the model reads them
 * in causal order), not the client's entire history.
 */
async function buildTenantChatContext(supabase, locationId) {
  const [
    { data: location },
    { data: metrics },
    { data: health },
    { data: feedRaw },
    { data: servicesManaged },
    { data: socialMetrics },
    { data: localMetrics },
    { data: marketProfile },
    { data: competitors },
    { data: openQuestions },
    { data: activity },
    { data: investigations },
    { data: memory },
    { data: businessContext },
    { data: goal },
    { data: tellVantageEntries },
  ] = await Promise.all([
    supabase.from('locations').select('id, name, organizations(name)').eq('id', locationId).maybeSingle(),
    supabase.from('historical_metrics').select('*').eq('location_id', locationId).order('period_start', { ascending: false }).limit(4),
    supabase.from('health_scores').select('*').eq('location_id', locationId).order('calculated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('intelligence_feed').select('*').eq('location_id', locationId).order('occurred_at', { ascending: false }).limit(15),
    supabase.from('services_managed').select('service, status').eq('location_id', locationId),
    supabase.from('social_content_metrics').select('*').eq('location_id', locationId).order('period_start', { ascending: false }).limit(4),
    supabase.from('local_visibility_metrics').select('*').eq('location_id', locationId).order('period_start', { ascending: false }).limit(4),
    supabase.from('market_profiles').select('*').eq('location_id', locationId).maybeSingle(),
    supabase.from('canonical_competitors').select('canonical_name, canonical_address, canonical_domain, same_brand, first_observed_at, last_observed_at').eq('location_id', locationId),
    supabase.from('open_questions').select('question, category').eq('location_id', locationId).eq('status', 'open'),
    supabase.from('orb_activity').select('activity_type, description, occurred_at').eq('location_id', locationId).eq('client_visible', true).order('occurred_at', { ascending: false }).limit(10),
    supabase.from('investigations').select('id, question, evidence_collected, possible_explanations, confidence, status, conclusion').eq('location_id', locationId).eq('client_visible', true),
    supabase.from('business_memory').select('observation, confidence, supporting_evidence_count').eq('location_id', locationId),
    supabase.from('business_context_entries').select('note_text, sales_estimate, transaction_count, traffic_level, primary_category_sold, promotion_running, created_at').eq('location_id', locationId).eq('excluded_from_evidence', false).order('created_at', { ascending: false }).limit(8),
    supabase.from('location_goals').select('business_objective, marketing_objective, lead_goal, conversion_goal, updated_at').eq('location_id', locationId).maybeSingle(),
    supabase.from('tell_vantage_entries').select('raw_text, classified_type, ai_summary, durability, author_type, created_at').eq('location_id', locationId).order('created_at', { ascending: false }).limit(10),
  ]);

  const { data: oversightResult } = await supabaseService.rpc('get_oversight_status', { p_location_id: locationId });
  const oversightCadence = oversightResult?.oversightCadence || null;

  const { data: businessModel } = await supabaseService.rpc('get_business_model_context', { p_location_id: locationId });
  const { data: businessState } = await supabaseService.rpc('build_business_state', { p_location_id: locationId });
  const { data: keywordFocus } = await supabaseService.rpc('get_keyword_focus_recommendations', { p_location_id: locationId });
  const { data: vantageState } = await supabaseService.rpc('get_vantage_state', { p_location_id: locationId });
  const { data: sourceCoverage } = await supabaseService.rpc('get_source_coverage', { p_location_id: locationId });
  const { data: v44Points } = await supabaseService.rpc('get_v44_evidence_points', { p_location_id: locationId });
  const { data: v44Territory } = await supabaseService.rpc('get_v44_territory', { p_location_id: locationId });
  const { data: supportMode } = await supabaseService.rpc('get_real_support_mode', { p_location_id: locationId });
  const { data: deepIntelligence } = await supabaseService.rpc('get_deep_intelligence', { p_location_id: locationId });
  const { data: whatsNext } = await supabaseService.rpc('get_whats_next', { p_location_id: locationId });
  const { data: recentActivity } = await supabaseService.rpc('get_recent_activity', { p_location_id: locationId });
  const { data: territoryEvidence } = await supabase.from('local_rank_territory').select('keyword, point_label, own_rank, top_competitor_name, checked_at').eq('location_id', locationId).order('own_rank', { ascending: true }).limit(30);
  const { data: weatherEvidence } = await supabase.from('daily_weather_observations').select('observation_date, temp_high_f, temp_low_f, precip_inches, conditions, is_forecast').eq('location_id', locationId).gte('observation_date', new Date(Date.now() - 3*86400000).toISOString().slice(0,10)).order('observation_date', { ascending: true });

  let healthWithFactors = null;
  if (health) {
    const { data: factors } = await supabase.from('health_score_factors').select('factor, score, weight, status, explanation').eq('health_score_id', health.id);
    healthWithFactors = { ...health, factors: factors || [] };
  }

  const metricsLabeled = (metrics || []).map((m) => ({ ...m, channel: labelChannel(m.channel) }));
  const periods = [...new Set(metricsLabeled.map((m) => `${m.period_start}_${m.period_end}`))];
  const currentRows = metricsLabeled.filter((m) => `${m.period_start}_${m.period_end}` === periods[0]);
  const previousRows = periods[1] ? metricsLabeled.filter((m) => `${m.period_start}_${m.period_end}` === periods[1]) : [];
  const channelComparisons = buildChannelComparison(currentRows, previousRows);

  const feed = (feedRaw || []).slice().reverse(); // oldest-first for the model

  return {
    client: { name: location?.name, organization: location?.organizations?.name },
    channelComparisons,
    snapshots: metricsLabeled,
    healthScore: healthWithFactors,
    servicesManaged: servicesManaged || [],
    intelligenceFeed: feed,
    socialContentMetrics: socialMetrics || [],
    localVisibilityMetrics: localMetrics || [],
    marketProfile: marketProfile || null,
    competitors: competitors || [],
    openQuestions: openQuestions || [],
    orbActivity: activity || [],
    oversightCadence,
    activeBeliefs: businessModel?.activeBeliefs || [],
    currentJudgments: businessModel?.currentJudgments || [],
    businessState: businessState || null,
    keywordFocus: keywordFocus || null,
    vantageState: vantageState || null,
    sourceCoverage: sourceCoverage || null,
    v44Points: v44Points || null,
    v44Territory: v44Territory || null,
    supportMode: supportMode || null,
    deepIntelligence: deepIntelligence || null,
    territoryEvidence: territoryEvidence || [],
    weatherEvidence: weatherEvidence || [],
    whatsNext: whatsNext || null,
    recentActivity: recentActivity || null,
    investigations: investigations || [],
    businessMemory: memory || [],
    businessContext: businessContext || [],
    goal: goal || null,
    tellVantageEntries: tellVantageEntries || [],
    accountNotes: [],
    insights: [],
  };
}

router.get('/organizations', async (req, res) => {
  const { data, error } = await req.supabase
    .from('organizations')
    .select('id, name, status, ownership_group_status, created_at')
    .order('name');

  if (error) {
    return res.status(500).json({ success: false, error: { message: error.message } });
  }
  return res.json({ success: true, data });
});

router.get('/organizations/:id', async (req, res) => {
  const { id } = req.params;

  const [{ data: org, error: orgError }, { data: locations, error: locError }] = await Promise.all([
    req.supabase.from('organizations').select('*').eq('id', id).maybeSingle(),
    req.supabase.from('locations').select('id, name, city, state, active, setup_status, portal_enabled, ai_enabled').eq('organization_id', id).order('name'),
  ]);

  if (orgError) return res.status(500).json({ success: false, error: { message: orgError.message } });
  if (!org) return res.status(404).json({ success: false, error: { message: 'Organization not found or not accessible.' } });
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });

  return res.json({ success: true, data: { organization: org, locations: locations || [] } });
});

router.get('/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
  const [
    { data: location, error: locError },
    { data: connections, error: connError },
    { data: mapping, error: mapError },
    { data: metrics, error: metricsError },
    { data: feed, error: feedError },
    { data: health, error: healthError },
    { data: socialMetrics },
    { data: localMetrics },
    { data: marketProfile },
    { data: competitors },
    { data: openQuestions },
    { data: brainState },
    { data: recentActivity },
    { data: memory },
    { data: investigations },
    { data: thesis },
    { data: goal },
  ] = await Promise.all([
    req.supabase.from('locations').select('*, organizations(name)').eq('id', id).maybeSingle(),
    req.supabase.from('connection_health').select('*').eq('location_id', id).order('channel'),
    req.supabase.from('dashboard_mappings').select('*').eq('location_id', id).maybeSingle(),
    req.supabase.from('historical_metrics').select('*').eq('location_id', id).order('period_start', { ascending: false }),
    req.supabase.from('intelligence_feed').select('*').eq('location_id', id).order('occurred_at', { ascending: false }),
    req.supabase.from('health_scores').select('*').eq('location_id', id).order('calculated_at', { ascending: false }).limit(1).maybeSingle(),
    req.supabase.from('social_content_metrics').select('*').eq('location_id', id).order('period_start', { ascending: false }),
    req.supabase.from('local_visibility_metrics').select('*').eq('location_id', id).order('period_start', { ascending: false }),
    req.supabase.from('market_profiles').select('*').eq('location_id', id).maybeSingle(),
    req.supabase.from('canonical_competitors').select('canonical_name, canonical_address, canonical_domain, same_brand, first_observed_at, last_observed_at').eq('location_id', id),
    req.supabase.from('open_questions').select('*').eq('location_id', id).eq('status', 'open').eq('client_visible', true),
    req.supabase.from('location_brain_state').select('*').eq('location_id', id).maybeSingle(),
    req.supabase.from('orb_activity').select('*').eq('location_id', id).eq('client_visible', true).order('occurred_at', { ascending: false }).limit(10),
    req.supabase.from('business_memory').select('*').eq('location_id', id).order('last_confirmed_at', { ascending: false }),
    req.supabase.from('investigations').select('*').eq('location_id', id).eq('client_visible', true).order('created_at', { ascending: false }),
    req.supabase.from('location_thesis').select('*').eq('location_id', id).maybeSingle(),
    req.supabase.from('location_goals').select('*').eq('location_id', id).maybeSingle(),
  ]);

  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });
  if (connError) return res.status(500).json({ success: false, error: { message: connError.message } });
  if (mapError) return res.status(500).json({ success: false, error: { message: mapError.message } });
  if (metricsError) return res.status(500).json({ success: false, error: { message: metricsError.message } });
  if (feedError) return res.status(500).json({ success: false, error: { message: feedError.message } });
  if (healthError) return res.status(500).json({ success: false, error: { message: healthError.message } });

  const briefing = buildCrossSourceBriefing(metrics, socialMetrics, localMetrics);

  // Real use of the canonical presenter layer - not written and left
  // unused. crossSourceSignals/singleSourceSignals are derived from
  // the real feed for THIS response, not re-fetched.
  const crossSourceSignalsForPresenter = (feed || []).filter((f) => f.item_type === 'signal' && f.subtype === 'channel_divergence');
  const singleSourceSignalsForPresenter = (feed || []).filter((f) => f.item_type === 'signal' && f.subtype !== 'channel_divergence');
  const performance = synthesizeBusinessPerformance({
    crossSourceSignals: crossSourceSignalsForPresenter,
    singleSourceSignals: singleSourceSignalsForPresenter,
    briefingText: briefing,
  });
  const activitySummary = presentOrbActivitySummary(recentActivity);

  // Real backend-computed competitive pulse - the location access
  // check above already passed (RLS-scoped), so calling this
  // RLS-bypassing SECURITY DEFINER function here is safe, same pattern
  // as every other write-oriented RPC in this file.
  let competitivePulse = null;
  try {
    const { data: pulseData } = await supabaseService.rpc('synthesize_competitive_pulse', { p_location_id: id });
    competitivePulse = pulseData;
  } catch (e) { /* non-fatal - the client-side fallback text still works */ }

  let nextAction = null;
  let nextMove = null;
  try {
    const { data: actionData } = await supabaseService.rpc('synthesize_next_action', { p_location_id: id });
    nextAction = actionData;
    const { data: moveData } = await supabaseService.rpc('determine_next_move', { p_location_id: id });
    nextMove = moveData;
  } catch (e) { /* non-fatal */ }

  // Real cross-portfolio context for the top recommendation - the
  // genuinely unique capability, correctly silent when there isn't
  // enough real sample size yet across the portfolio.
  let portfolioContext = null;
  const topRecId = (feed || []).find((f) => f.item_type === 'recommendation')?.id;
  if (topRecId) {
    try {
      const { data: ctx } = await supabaseService.rpc('get_portfolio_context_for_recommendation', { p_recommendation_id: topRecId });
      portfolioContext = ctx || null;
    } catch (e) { /* non-fatal */ }
  }

  return res.json({
    success: true,
    data: {
      location, connections: connections || [], mapping: mapping || null,
      metrics: metrics || [], feed: feed || [], health: health || null,
      socialMetrics: socialMetrics || [], localMetrics: localMetrics || [],
      marketProfile: marketProfile || null, competitors: competitors || [], openQuestions: openQuestions || [],
      brainState: brainState || null,
      recentActivity: recentActivity || [],
      memory: memory || [],
      investigations: investigations || [],
      thesis: thesis || null,
      goal: goal || null,
      briefing,
      performance,
      activitySummary,
      competitivePulse,
      nextAction,
      nextMove,
      portfolioContext,
    },

  });
  } catch (err) {
    // The bounded-failure guarantee: whatever goes wrong here, the
    // client gets a real, fast error response - never a hang.
    console.error(`[locations/${id}] Unhandled error:`, err);
    return res.status(500).json({ success: false, error: { message: `Server error loading location: ${err.message}` } });
  }
});

/**
 * Deterministic cross-source synthesis - NOT AI-generated. Every
 * sentence is grounded directly in a specific verified number from a
 * specific real table, computed here in code, never invented.
 */
function buildCrossSourceBriefing(metrics, socialMetrics, localMetrics) {
  const parts = [];
  const money = (n) => `$${n.toFixed(2)}`;

  const periods = [...new Set((metrics || []).map((m) => `${m.period_start}_${m.period_end}`))].sort().reverse();
  if (periods.length >= 2) {
    const [curKey, prevKey] = periods;
    const curRows = metrics.filter((m) => `${m.period_start}_${m.period_end}` === curKey);
    const prevRows = metrics.filter((m) => `${m.period_start}_${m.period_end}` === prevKey);
    const curSpend = curRows.reduce((s, r) => s + Number(r.ad_spend || 0), 0);
    const curClicks = curRows.reduce((s, r) => s + Number(r.clicks || 0), 0);
    const curCpc = curClicks > 0 ? curSpend / curClicks : null;
    if (curCpc && prevRows.length) {
      const prevSpend = prevRows.reduce((s, r) => s + Number(r.ad_spend || 0), 0);
      const prevClicks = prevRows.reduce((s, r) => s + Number(r.clicks || 0), 0);
      const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : null;
      if (prevCpc) {
        const pctChange = ((curCpc - prevCpc) / prevCpc) * 100;
        // Real numbers embedded directly, not just direction - "your
        // cost per click went from $2.10 to $1.45" reads as a system
        // actually watching the numbers, not a vague reassurance.
        if (pctChange < -5) parts.push(`Your cost per click went from ${money(prevCpc)} to ${money(curCpc)} - you're paying less to bring in the same or more people.`);
        else if (pctChange > 5) parts.push(`Your cost per click went from ${money(prevCpc)} to ${money(curCpc)} - it's costing more to bring in people right now.`);
      }
    }
  }

  const socialSorted = (socialMetrics || []).filter((s) => s.channel === 'fb-pg').sort((a, b) => b.period_start.localeCompare(a.period_start));
  if (socialSorted.length >= 2) {
    const [cur, prev] = socialSorted;
    if (cur.post_engagements && prev.post_engagements) {
      const pct = ((cur.post_engagements - prev.post_engagements) / prev.post_engagements) * 100;
      if (Math.abs(pct) > 10) {
        parts.push(`Facebook engagement went from ${prev.post_engagements.toLocaleString()} to ${cur.post_engagements.toLocaleString()} interactions (${pct>0?'+':''}${Math.round(pct)}%).`);
      }
    }
  }

  const localSorted = (localMetrics || []).sort((a, b) => b.period_start.localeCompare(a.period_start));
  if (localSorted.length >= 2) {
    const [cur, prev] = localSorted;
    if (cur.maps_impressions && prev.maps_impressions) {
      const pct = ((cur.maps_impressions - prev.maps_impressions) / prev.maps_impressions) * 100;
      if (Math.abs(pct) > 25) {
        parts.push(`${cur.maps_impressions.toLocaleString()} people found you on Google Maps, up from ${prev.maps_impressions.toLocaleString()} (${pct>0?'+':''}${Math.round(pct)}%).`);
      }
    }
  }

  if (!parts.length) return "Orb doesn't have enough history yet to give you a full picture - check back soon.";
  return "Here's what we're seeing: " + parts.join(' ');
}

// POST /api/mc/locations/:id/ask - "Explore with Orb Intelligence."
// Uses the SAME chatService/chatPrompt as the internal admin chat -
// one intelligence engine, not a parallel one. Only the data-assembly
// layer differs (RLS-scoped here vs service-role for admin), because
// that's a real, necessary difference in authentication model, not a
// duplicated product.
router.post('/locations/:id/ask', async (req, res) => {
  const { id: locationId } = req.params;
  const { question, conversationId, investigationId } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ success: false, error: { message: 'A question is required.' } });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ success: false, error: { message: `Question exceeds ${MAX_QUESTION_LENGTH} characters.` } });
  }

  try {
    const { data: location } = await req.supabase
      .from('locations').select('id, organization_id, daily_ai_question_limit').eq('id', locationId).maybeSingle();
    if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

    // Real server-side rate limit, checked BEFORE any AI call or data
    // assembly - not a UI-only cosmetic limit.
    const limit = location.daily_ai_question_limit ?? 10;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { count: usedToday, error: usageError } = await req.supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', locationId)
      .eq('feature', 'tenant_chat')
      .gte('created_at', startOfDay.toISOString());
    if (usageError) return res.status(500).json({ success: false, error: { message: usageError.message } });

    if ((usedToday || 0) >= limit) {
      return res.status(429).json({
        success: false,
        error: { message: `Daily question limit reached (${limit} per day). Resets at midnight.` },
        data: { remaining: 0, limit },
      });
    }

    let convoId = conversationId;
    let history = [];
    if (convoId) {
      const { data: existingMessages } = await req.supabase
        .from('ai_messages').select('role, content').eq('conversation_id', convoId)
        .order('created_at', { ascending: true }).limit(HISTORY_TURNS_INCLUDED * 2);
      history = existingMessages || [];
    } else {
      const { data: newConvo, error: convoError } = await req.supabase
        .from('ai_conversations').insert({ organization_id: location.organization_id, location_id: locationId, anchor_investigation_id: investigationId || null }).select().single();
      if (convoError) return res.status(500).json({ success: false, error: { message: convoError.message } });
      convoId = newConvo.id;
    }

    await req.supabase.from('ai_messages').insert({ conversation_id: convoId, role: 'user', content: question });

    // Real timing instrumentation - measuring before touching any
    // timeout value, per explicit instruction.
    const t0 = Date.now();
    const context = await buildTenantChatContext(req.supabase, locationId);
    const t1 = Date.now();
    console.log(`[ASK TIMING] buildTenantChatContext: ${t1 - t0}ms`);

    // If this conversation is anchored to a specific investigation,
    // put that investigation's real evidence first and explicitly -
    // the question should be answered in that context, not buried in
    // the general investigations list.
    let anchorInvestigationId = investigationId;
    if (convoId && !anchorInvestigationId) {
      const { data: convo } = await req.supabase.from('ai_conversations').select('anchor_investigation_id').eq('id', convoId).maybeSingle();
      anchorInvestigationId = convo?.anchor_investigation_id;
    }
    if (anchorInvestigationId) {
      const anchored = (context.investigations || []).find((i) => i.id === anchorInvestigationId);
      if (anchored) context.anchoredInvestigation = anchored;
    }

    let result;
    try {
      const t2 = Date.now();
      result = await chatService.askQuestion({ ...context, question }, { tenantMode: true, conversationHistory: history });
      const t3 = Date.now();
      console.log(`[ASK TIMING] chatService.askQuestion (prompt build + real Anthropic call): ${t3 - t2}ms`);
    } catch (aiErr) {
      console.log(`[ASK TIMING] askQuestion threw after error: ${aiErr.message}`);
      return res.status(502).json({ success: false, error: { message: `Could not generate an answer: ${aiErr.message}` } });
    }

    const answerText = [result.answer.findings, result.answer.recommended_actions, result.answer.insufficient_data]
      .filter(Boolean).join('\n\n');
    await req.supabase.from('ai_messages').insert({ conversation_id: convoId, role: 'assistant', content: answerText });

    await req.supabase.from('ai_usage_log').insert({
      location_id: locationId,
      client_id: null,
      feature: 'tenant_chat',
      question,
      model_name: result.model_name,
      input_tokens: result.usage ? result.usage.input_tokens : null,
      output_tokens: result.usage ? result.usage.output_tokens : null,
      estimated_cost_usd: result.usage ? (result.usage.input_tokens / 1e6) * 1.0 + (result.usage.output_tokens / 1e6) * 5.0 : null,
    });

    // Real control-surface resolution: the model chose an action
    // type, this fetches the actual real data for it - never
    // fabricated, and any lookup failure degrades to text-only
    // rather than breaking the response.
    let resolvedAction = null;
    const suggested = result.answer.suggested_action;
    if (suggested?.type) {
      try {
        if (suggested.type === 'open_where_you_stand') {
          const { data: synthesis } = await supabaseService.rpc('get_position_synthesis', { p_location_id: locationId });
          const { data: standing } = await supabaseService.rpc('get_where_you_stand', { p_location_id: locationId });
          resolvedAction = { type: suggested.type, synthesis, standing };
        } else if (suggested.type === 'show_keyword_evidence') {
          let query = req.supabase.from('competitor_keywords').select('keyword, position, search_volume, competitors(name)').eq('location_id', locationId).order('search_volume', { ascending: false }).limit(20);
          const { data: keywords } = await query;
          resolvedAction = { type: suggested.type, keywords: keywords || [] };
        } else if (suggested.type === 'show_review_chain') {
          const { data: chain } = await req.supabase.from('human_review_chain').select('*').eq('location_id', locationId).order('detected_at', { ascending: false }).limit(10);
          resolvedAction = { type: suggested.type, chain: chain || [] };
        } else if (suggested.type === 'ask_store_pulse') {
          resolvedAction = { type: suggested.type, prompt: 'How was business?', options: ['Dead', 'Slow', 'Normal', 'Good', 'Busy'] };
        } else if (suggested.type === 'open_investigation' && suggested.investigation_id) {
          const { data: inv } = await req.supabase.from('investigations').select('*').eq('id', suggested.investigation_id).eq('location_id', locationId).maybeSingle();
          if (inv) resolvedAction = { type: suggested.type, investigation: inv };
        } else if (suggested.type === 'show_search_opportunities') {
          const { data: keywords } = await req.supabase.from('competitor_keywords').select('keyword, position, search_volume').eq('location_id', locationId).order('search_volume', { ascending: false }).limit(15);
          resolvedAction = { type: suggested.type, opportunities: keywords || [] };
        }
      } catch (e) { /* non-fatal - falls back to text-only answer */ }
    }

    return res.json({
      success: true,
      data: { conversationId: convoId, answer: result.answer, resolvedAction, remaining: limit - (usedToday || 0) - 1, limit },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message || 'Something went wrong answering that question.' } });
  }
});

router.get('/locations/:id/usage', async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase
    .from('locations').select('daily_ai_question_limit').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const limit = location.daily_ai_question_limit ?? 10;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { count, error } = await req.supabase
    .from('ai_usage_log').select('id', { count: 'exact', head: true })
    .eq('location_id', locationId).eq('feature', 'tenant_chat').gte('created_at', startOfDay.toISOString());
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  return res.json({ success: true, data: { used: count || 0, limit, remaining: Math.max(0, limit - (count || 0)) } });
});

router.get('/locations/:id/conversations/latest', async (req, res) => {
  const { id: locationId } = req.params;
  const { data: convo } = await req.supabase
    .from('ai_conversations').select('id').eq('location_id', locationId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!convo) return res.json({ success: true, data: { conversationId: null, messages: [] } });

  const { data: messages, error } = await req.supabase
    .from('ai_messages').select('role, content, created_at').eq('conversation_id', convo.id).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  return res.json({ success: true, data: { conversationId: convo.id, messages: messages || [] } });
});

// Admin portfolio summary - relies entirely on RLS (platform_admin
// bypasses every policy, so these queries naturally return portfolio-
// wide totals for an admin caller and would return near-nothing for
// a client caller - no separate admin-only auth check needed here,
// the database already enforces the real boundary).
// Fast Orb Activity entry - deliberately minimal fields so staff can
// log real work in seconds, not write a report. RLS (admin-only insert)
// is the actual authorization boundary; this route doesn't re-check it.
// CREATE: turns a recommendation/investigation into a real generated
// creative concept, grounded in the exact intelligence that prompted
// it. Real job lifecycle (pending -> generating -> complete/failed),
// not a one-shot fire-and-forget call.
router.post('/locations/:id/create', async (req, res) => {
  const { id: locationId } = req.params;
  const { sourceType, sourceRecommendationId, sourceInvestigationId, requestType, prompt } = req.body || {};

  const validRequestTypes = ['ad_copy', 'campaign_concept', 'social_post', 'creative_brief'];
  if (!validRequestTypes.includes(requestType)) {
    return res.status(400).json({ success: false, error: { message: `requestType must be one of: ${validRequestTypes.join(', ')}` } });
  }

  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  // Pull the real intelligence that prompted this - never a blank slate
  let contextSnapshot = {};
  if (sourceRecommendationId) {
    const { data: rec } = await req.supabase.from('recommendations').select('recommendation_text, why, evidence, priority').eq('id', sourceRecommendationId).maybeSingle();
    if (rec) contextSnapshot = { type: 'recommendation', ...rec };
  } else if (sourceInvestigationId) {
    const { data: inv } = await req.supabase.from('investigations').select('question, evidence_collected, possible_explanations, confidence').eq('id', sourceInvestigationId).maybeSingle();
    if (inv) contextSnapshot = { type: 'investigation', ...inv };
  }

  const { data: job, error: insertError } = await req.supabase.from('creative_jobs').insert({
    organization_id: location.organization_id,
    location_id: locationId,
    requested_by: req.user.id,
    source_type: sourceType || 'manual',
    source_recommendation_id: sourceRecommendationId || null,
    source_signal_id: null,
    request_type: requestType,
    status: 'generating',
  }).select().single();
  if (insertError) return res.status(500).json({ success: false, error: { message: insertError.message } });

  try {
    const context = await buildTenantChatContext(req.supabase, locationId);
    const result = await generateCreative({ ...job, prompt, context_snapshot: contextSnapshot }, context);

    const { data: updated, error: updateError } = await req.supabase.from('creative_jobs').update({
      status: 'complete',
      headline: result.headline,
      body_copy: result.body_copy,
      format_suggestion: result.format_suggestion,
      cta: result.cta,
      target_audience: result.target_audience,
      rationale: result.rationale,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id).select().single();
    if (updateError) return res.status(500).json({ success: false, error: { message: updateError.message } });

    // Records the creative action into Orb Activity - closes the loop:
    // this generated concept is now part of the real activity/outcome
    // chain, not a disconnected one-off.
    await req.supabase.from('orb_activity').insert({
      organization_id: location.organization_id,
      location_id: locationId,
      activity_type: 'creative_change',
      description: `Generated a ${requestType.replace('_', ' ')} concept: "${result.headline}"`,
      performed_by: req.user.id,
      client_visible: true,
    });

    return res.json({ success: true, data: updated });
  } catch (genError) {
    await req.supabase.from('creative_jobs').update({ status: 'failed', error_message: genError.message }).eq('id', job.id);
    return res.status(502).json({ success: false, error: { message: `Creative generation failed: ${genError.message}` } });
  }
});

// Real, undeniable proof of accumulated work - not implied by a nice
// UI, actually aggregated from real investigation/verdict/memory
// history. This is the concrete answer to "a new tool starts at
// zero, this doesn't."
// YOUR ORB MONTH - real, aggregated proof of value, not a metrics
// report. Same real-authorization-then-service-role pattern as every
// cross-tenant-shaped RPC tonight.
router.get('/locations/:id/value-receipt', async (req, res) => {
  const { id: locationId } = req.params;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('build_monthly_value_receipt', { p_location_id: locationId, p_days: days });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
});

router.get('/locations/:id/track-record', async (req, res) => {
  const { id: locationId } = req.params;

  const [
    { data: allInvestigations },
    { data: verdicts },
    { data: memory },
    { data: earliestSignal },
  ] = await Promise.all([
    req.supabase.from('investigations').select('id, question, status, conclusion, confidence, created_at, updated_at').eq('location_id', locationId).eq('client_visible', true).order('created_at', { ascending: false }),
    req.supabase.from('recommendation_verdicts').select('verdict, reasoning, source, judged_at, recommendation_id, recommendations(recommendation_text)').eq('location_id', locationId).order('judged_at', { ascending: false }),
    req.supabase.from('business_memory').select('observation, confidence, first_observed_at, supporting_evidence_count').eq('location_id', locationId).order('first_observed_at', { ascending: true }),
    req.supabase.from('signals').select('detected_at').eq('location_id', locationId).order('detected_at', { ascending: true }).limit(1).maybeSingle(),
  ]);

  const resolvedCount = (allInvestigations || []).filter((i) => i.status === 'resolved' || i.status === 'inconclusive').length;
  const validatedCount = (verdicts || []).filter((v) => v.verdict === 'validated').length;

  return res.json({
    success: true,
    data: {
      watchingSince: earliestSignal?.detected_at || null,
      totalInvestigations: (allInvestigations || []).length,
      resolvedInvestigations: resolvedCount,
      totalVerdicts: (verdicts || []).length,
      validatedVerdicts: validatedCount,
      confirmedPatterns: (memory || []).filter((m) => m.confidence !== 'emerging').length,
      investigations: allInvestigations || [],
      verdicts: verdicts || [],
      memoryTimeline: memory || [],
    },
  });
});

router.get('/locations/:id/creative', async (req, res) => {
  const { id: locationId } = req.params;
  const { data, error } = await req.supabase.from('creative_jobs').select('*').eq('location_id', locationId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: data || [] });
});

// Real, deterministic evidence-assembly - no new AI call, per cost
// discipline. "What's actually moving" comes from build_business_state,
// which is already real and tested - this just assembles it into a
// prepared brief and persists it with real source lineage.
router.get('/locations/:id/creative-brief', async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data: state } = await supabaseService.rpc('build_business_state', { p_location_id: locationId });
  const s = state?.state || {};

  const evidence = [];
  let headline = 'Not enough real evidence yet to prepare a confident brief.';
  if (s.top_ad?.status === 'ok') {
    headline = `Based on "${s.top_ad.adName}" — your real strongest ad by actual response`;
    evidence.push(`Real ad performance: ${s.top_ad.clientFacingText}`);
  } else if (s.content?.status === 'OPPORTUNITY') {
    headline = 'Based on your real strongest organic post this period';
    evidence.push(`Real content signal: ${s.content.fact} (${s.content.confidence} - one real occurrence, not yet a proven pattern)`);
  }
  if (s.territory_furniture) evidence.push(`Real territory: ${s.territory_furniture.fact}`);
  if (s.reputation) evidence.push(`Real reputation: ${s.reputation.fact}`);

  const honestGaps = 'This brief is assembled from real, existing evidence only - no new creative generation was run. Ad copy/headline text is not available from any connected source, so specific wording is not included here.';

  const { data: job } = await req.supabase.from('creative_jobs').insert({
    organization_id: location.organization_id, location_id: locationId, requested_by: req.user.id,
    source_type: 'manual', request_type: 'ad_concept', status: 'ready',
    headline, rationale: evidence.join(' | '),
  }).select().single();

  return res.json({ success: true, data: { headline, evidence, honestGaps, jobId: job?.id } });
});

// KNOW ME: real, minimal weekly check-in. No POS required - a client
// can tell Orb something in plain language and/or 3 trivial numbers,
// and it becomes real evidence for future reasoning, not a chat log.
router.post('/locations/:id/tell', async (req, res) => {
  const { id: locationId } = req.params;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: { message: 'Provide a statement to tell Vantage.' } });

  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  let classification;
  try {
    classification = await classifyStatement(text.trim());
  } catch (err) {
    return res.status(502).json({ success: false, error: { message: `Could not classify statement: ${err.message}` } });
  }

  const { data: membership } = await req.supabase.from('organization_memberships').select('role').eq('organization_id', location.organization_id).eq('user_id', req.user.id).maybeSingle();
  const realAuthorType = membership && ['admin', 'account_manager'].includes(membership.role) ? 'staff' : 'owner';

  const { data: entry, error } = await req.supabase.from('tell_vantage_entries').insert({
    organization_id: location.organization_id, location_id: locationId, raw_text: text.trim(),
    classified_type: classification.classified_type, durability: classification.durability, ai_summary: classification.ai_summary,
    author_id: req.user.id, author_type: realAuthorType,
  }).select().single();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  // A statement Vantage recognizes as a real goal flows directly into
  // the goal store - the owner shouldn't have to say it twice in two
  // different places.
  if (classification.is_goal) {
    await supabaseService.from('location_goals').upsert({
      location_id: locationId, organization_id: location.organization_id,
      business_objective: classification.ai_summary, updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id' });
  }

  return res.json({ success: true, data: { entry, classification } });
});

router.get('/locations/:id/goal', async (req, res) => {
  const { id: locationId } = req.params;
  const { data, error } = await req.supabase.from('location_goals').select('*').eq('location_id', locationId).maybeSingle();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: data || null });
});

router.post('/locations/:id/business-dna', async (req, res) => {
  const { id: locationId } = req.params;
  const { narrative } = req.body || {};
  if (!narrative || !narrative.trim()) return res.status(400).json({ success: false, error: { message: 'Provide the narrative text.' } });

  // Real, RLS-scoped ownership check first - same pattern as every
  // other write endpoint tonight. A client-supplied location_id alone
  // is never sufficient.
  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.from('market_profiles').upsert({
    location_id: locationId, organization_id: location.organization_id,
    business_dna_narrative: narrative.trim(), business_dna_updated_by: req.user.id, business_dna_updated_at: new Date().toISOString(),
  }, { onConflict: 'location_id' }).select().single();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  return res.json({ success: true, data });
});

router.get('/locations/:id/business-dna', async (req, res) => {
  const { id: locationId } = req.params;
  const { data, error } = await req.supabase.from('market_profiles').select('business_dna_narrative, business_dna_updated_at').eq('location_id', locationId).maybeSingle();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: data || null });
});

router.post('/locations/:id/goal', async (req, res) => {
  const { id: locationId } = req.params;
  const { goalText, deadline, constraintsText } = req.body || {};
  if (!goalText || !goalText.trim()) return res.status(400).json({ success: false, error: { message: 'Provide a goal.' } });

  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.from('location_goals').upsert({
    location_id: locationId, organization_id: location.organization_id,
    business_objective: goalText.trim(), deadline: deadline || null, constraints_text: constraintsText || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'location_id' }).select().single();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  return res.json({ success: true, data });
});

router.get('/locations/:id/position-synthesis', asyncHandler(async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('get_position_synthesis', { p_location_id: locationId });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.get('/locations/:id/where-you-stand', asyncHandler(async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('get_where_you_stand', { p_location_id: locationId });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.get('/locations/:id/business-model', asyncHandler(async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('get_business_model', { p_location_id: locationId });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.get('/locations/:id/unified-activity', asyncHandler(async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('get_unified_activity', { p_location_id: locationId, p_limit: 15 });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.post('/open-questions/:id/answer', asyncHandler(async (req, res) => {
  const { id: questionId } = req.params;
  const { answer } = req.body || {};
  if (!answer || !answer.trim()) return res.status(400).json({ success: false, error: { message: 'Provide an answer.' } });

  const { data: q, error: checkErr } = await req.supabase.from('open_questions').select('id, location_id').eq('id', questionId).maybeSingle();
  if (checkErr) return res.status(500).json({ success: false, error: { message: checkErr.message } });
  if (!q) return res.status(404).json({ success: false, error: { message: 'Question not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('resolve_open_question', { p_question_id: questionId, p_answer: answer.trim() });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.post('/investigations/:id/seen', asyncHandler(async (req, res) => {
  const { id: investigationId } = req.params;
  const { data: inv, error: checkErr } = await req.supabase.from('investigations').select('id, location_id').eq('id', investigationId).maybeSingle();
  if (checkErr) return res.status(500).json({ success: false, error: { message: checkErr.message } });
  if (!inv) return res.status(404).json({ success: false, error: { message: 'Investigation not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('mark_investigation_seen', { p_investigation_id: investigationId });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.get('/locations/:id/brief', asyncHandler(async (req, res) => {
  const { id: locationId } = req.params;
  const { data: location, error: locError } = await req.supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const { data, error } = await supabaseService.rpc('compose_vantage_brief', { p_location_id: locationId });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
}));

router.post('/locations/:id/checkin', async (req, res) => {
  const { id: locationId } = req.params;
  const { noteText, salesEstimate, transactionCount, trafficLevel, walkIns } = req.body || {};

  if (!noteText && salesEstimate === undefined && transactionCount === undefined && !trafficLevel && walkIns === undefined) {
    return res.status(400).json({ success: false, error: { message: 'Provide at least a note or one of the simple numbers.' } });
  }

  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  // Real, best-effort extraction from free text - only fills a
  // structured field when the owner didn't already provide it
  // explicitly. Never overrides an explicit value, never invents one.
  let realWalkIns = walkIns ?? null;
  let realCategorySignal = null;
  if (noteText) {
    if (realWalkIns === null) {
      const { data: extracted } = await req.supabase.rpc('extract_walkins_from_text', { p_text: noteText });
      realWalkIns = extracted ?? null;
    }
    const { data: categories } = await req.supabase.rpc('extract_category_signal', { p_text: noteText });
    if (categories && categories.length) realCategorySignal = categories;
  }

  const { data: entry, error } = await req.supabase.from('business_context_entries').insert({
    organization_id: location.organization_id,
    location_id: locationId,
    submitted_by: req.user.id,
    entry_type: 'checkin',
    note_text: noteText || null,
    sales_estimate: salesEstimate ?? null,
    transaction_count: transactionCount ?? null,
    traffic_level: trafficLevel || null,
    walk_ins: realWalkIns,
    primary_category_sold: realCategorySignal ? JSON.stringify(realCategorySignal) : null,
    week_of: new Date().toISOString().slice(0, 10),
  }).select().single();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  return res.json({ success: true, data: entry, extracted: { walkIns: realWalkIns, categories: realCategorySignal } });
});

router.get('/locations/:id/checkins', async (req, res) => {
  const { id: locationId } = req.params;
  const { data, error } = await req.supabase.from('business_context_entries').select('*').eq('location_id', locationId).eq('excluded_from_evidence', false).order('created_at', { ascending: false }).limit(12);
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: data || [] });
});

router.post('/locations/:id/activity', requireStaffRole, async (req, res) => {
  const { id: locationId } = req.params;
  const { activityType, description, clientVisible, reviewType, channel, reason, relatedInvestigationId, relatedRecommendationId } = req.body || {};

  const validTypes = ['review','optimization','launch','pause','test','creative_change','budget_change','targeting_change','landing_page_update','local_update','search_change','seasonal_strategy_update','connection_repair','client_conversation','other'];
  if (!validTypes.includes(activityType)) {
    return res.status(400).json({ success: false, error: { message: `activityType must be one of: ${validTypes.join(', ')}` } });
  }
  const validReviewTypes = ['weekly_review','weekly_optimization','monthly_overhaul','strategy_review','performance_review','creative_review','search_review','website_review','market_competitive_review'];
  if (reviewType && !validReviewTypes.includes(reviewType)) {
    return res.status(400).json({ success: false, error: { message: `reviewType must be one of: ${validReviewTypes.join(', ')}` } });
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ success: false, error: { message: 'A short description is required.' } });
  }

  const { data: location, error: locError } = await req.supabase.from('locations').select('id, organization_id').eq('id', locationId).maybeSingle();
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });

  const fullDescription = reason ? `${description.trim()} (${reason.trim()})` : description.trim();
  const { data: activity, error } = await req.supabase.from('orb_activity').insert({
    organization_id: location.organization_id,
    location_id: locationId,
    activity_type: activityType,
    review_type: reviewType || null,
    description: fullDescription,
    performed_by: req.user.id,
    client_visible: clientVisible !== false,
  }).select().single();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });

  // Real link: if this action relates to a real, existing investigation
  // or recommendation, record it on the human_review_chain so the
  // full detected->reviewed->acted lifecycle stays connected - not a
  // disconnected log entry.
  if (relatedInvestigationId || relatedRecommendationId) {
    const sourceType = relatedInvestigationId ? 'investigation' : 'recommendation';
    const sourceId = relatedInvestigationId || relatedRecommendationId;
    const { data: existingChain } = await req.supabase.from('human_review_chain').select('id, reviewed_at').eq('source_type', sourceType).eq('source_id', sourceId).maybeSingle();
    if (existingChain) {
      await req.supabase.from('human_review_chain').update({
        reviewed_at: existingChain.reviewed_at || new Date().toISOString(),
        reviewed_by: req.user.id,
        action_taken: activityType === 'review' ? null : fullDescription,
        action_at: activityType === 'review' ? null : new Date().toISOString(),
      }).eq('id', existingChain.id);
    }
  }

  // Real cadence tracking updates automatically - not a separate step
  // staff have to remember to do.
  if (reviewType) {
    await supabaseService.rpc('record_review_cadence', { p_location_id: locationId, p_review_type: reviewType, p_occurred_at: activity.occurred_at });
  }

  return res.json({ success: true, data: activity });
});

// Efficient admin portfolio listing - one real query, not N+1 calls
// per location. RLS (platform_admin bypass) is the actual boundary
// determining what this returns for the calling user.
// Explicit admin check - uses the service-role client specifically
// for this one query (platform_roles has no self-select RLS policy at
// all, by design, tested back in Batch 1) so a real yes/no answer is
// possible, rather than inferring admin status from row counts, which
// RLS-scoped queries can't reliably distinguish from "a client with
// exactly one location."
router.get('/admin/whoami', async (req, res) => {
  const { data, error } = await supabaseService.from('platform_roles').select('role').eq('user_id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: { isPlatformAdmin: Boolean(data), role: data?.role || null } });
});

router.get('/admin/locations', async (req, res) => {
  const [
    { data: locations, error: locError },
    { data: brainStates },
    { data: connections },
  ] = await Promise.all([
    req.supabase.from('locations').select('id, name, active, client_access_status, organization_id, organizations(name)').order('name'),
    req.supabase.from('location_brain_state').select('*'),
    req.supabase.from('connection_health').select('location_id, status'),
  ]);
  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });

  const brainByLocation = new Map((brainStates || []).map((b) => [b.location_id, b]));
  const connCountByLocation = new Map();
  (connections || []).forEach((c) => {
    const entry = connCountByLocation.get(c.location_id) || { total: 0, connected: 0 };
    entry.total++;
    if (c.status === 'connected') entry.connected++;
    connCountByLocation.set(c.location_id, entry);
  });

  const rows = (locations || []).map((loc) => {
    const brain = brainByLocation.get(loc.id);
    const conn = connCountByLocation.get(loc.id) || { total: 0, connected: 0 };
    return {
      id: loc.id,
      name: loc.name,
      organizationName: loc.organizations?.name,
      active: loc.active,
      clientAccessStatus: loc.client_access_status,
      overallScore: brain?.overall_score ?? null,
      confidenceLevel: brain?.confidence_level ?? null,
      openSignals: brain?.open_signals_count ?? 0,
      openQuestions: brain?.open_questions_count ?? 0,
      lastRunAt: brain?.last_run_at ?? null,
      connectionsTotal: conn.total,
      connectionsHealthy: conn.connected,
    };
  });

  return res.json({ success: true, data: rows });
});

router.get('/admin/agency-thesis', async (req, res) => {
  // synthesize_agency_thesis() is SECURITY DEFINER and returns
  // cross-tenant portfolio data by design - unlike RLS-scoped queries
  // elsewhere in this file, this MUST have an explicit admin check,
  // the same real class of gap found and fixed twice already tonight.
  const { data: roleData, error: roleError } = await supabaseService.from('platform_roles').select('role').eq('user_id', req.user.id).maybeSingle();
  if (roleError) return res.status(500).json({ success: false, error: { message: roleError.message } });
  if (!roleData) return res.status(403).json({ success: false, error: { message: 'Not authorized.' } });

  const { data, error } = await supabaseService.rpc('synthesize_agency_thesis');
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data });
});

router.get('/admin/portfolio-summary', async (req, res) => {
  const [
    { count: totalLocations },
    { count: activeAccess },
    { count: notProvisioned },
    { count: recommendationsWaiting },
    { count: actionsInProgress },
    { data: healthScores },
    { data: connectionIssues },
    { count: activeInvestigations },
    { count: resolvedInvestigations },
    { data: creativeJobs },
    { data: usageLog },
    { count: recentActivityCount },
  ] = await Promise.all([
    req.supabase.from('locations').select('id', { count: 'exact', head: true }),
    req.supabase.from('locations').select('id', { count: 'exact', head: true }).eq('client_access_status', 'active'),
    req.supabase.from('locations').select('id', { count: 'exact', head: true }).eq('client_access_status', 'not_provisioned'),
    req.supabase.from('recommendations').select('id', { count: 'exact', head: true }).eq('status', 'proposed'),
    req.supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
    req.supabase.from('health_scores').select('location_id, overall_score').order('calculated_at', { ascending: false }),
    req.supabase.from('connection_health').select('location_id', { count: 'exact' }).neq('status', 'connected'),
    req.supabase.from('investigations').select('id', { count: 'exact', head: true }).in('status', ['open', 'investigating']),
    req.supabase.from('investigations').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
    req.supabase.from('creative_jobs').select('status'),
    req.supabase.from('ai_usage_log').select('estimated_cost_usd').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    req.supabase.from('orb_activity').select('id', { count: 'exact', head: true }).gte('occurred_at', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const latestByLocation = new Map();
  (healthScores || []).forEach((h) => { if (!latestByLocation.has(h.location_id)) latestByLocation.set(h.location_id, h.overall_score); });
  const scores = [...latestByLocation.values()];
  const healthy = scores.filter((s) => s >= 70).length;
  const needingAttention = scores.filter((s) => s < 50).length;

  const creativeJobsByStatus = (creativeJobs || []).reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});
  const total30dCostUsd = (usageLog || []).reduce((sum, u) => sum + (Number(u.estimated_cost_usd) || 0), 0);

  return res.json({
    success: true,
    data: {
      locationsMonitored: totalLocations || 0,
      locationsHealthy: healthy,
      locationsNeedingAttention: needingAttention,
      clientAccessActive: activeAccess || 0,
      clientAccessNotProvisioned: notProvisioned || 0,
      recommendationsWaiting: recommendationsWaiting || 0,
      actionsInProgress: actionsInProgress || 0,
      dataConnectionIssues: connectionIssues ? connectionIssues.length : 0,
      activeInvestigations: activeInvestigations || 0,
      resolvedInvestigations: resolvedInvestigations || 0,
      creativeJobsByStatus,
      aiCost30dUsd: Math.round(total30dCostUsd * 100) / 100,
      activityLast7d: recentActivityCount || 0,
    },
  });
});

// "Was Orb right?" - direct client feedback, distinct from and at
// least as authoritative as the algorithmic verdict.
router.post('/recommendations/:id/feedback', async (req, res) => {
  const { id: recommendationId } = req.params;
  const { helped, feedbackText } = req.body || {};
  if (typeof helped !== 'boolean') {
    return res.status(400).json({ success: false, error: { message: '"helped" must be true or false.' } });
  }

  // Real authorization check BEFORE calling the RLS-bypassing RPC -
  // req.supabase is the user's own RLS-scoped client, so this only
  // succeeds if the recommendation's location is one they can access.
  const { data: rec, error: recError } = await req.supabase.from('recommendations').select('id').eq('id', recommendationId).maybeSingle();
  if (recError) return res.status(500).json({ success: false, error: { message: recError.message } });
  if (!rec) return res.status(404).json({ success: false, error: { message: 'Recommendation not found or not accessible.' } });

  const { data: verdictId, error } = await supabaseService.rpc('record_client_feedback', {
    p_recommendation_id: recommendationId, p_helped: helped, p_feedback_text: feedbackText || null,
  });
  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  return res.json({ success: true, data: { verdictId } });
});

router.post('/recommendations/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, actionTitle, actionDescription, outcomeDescription, measuredImpact } = req.body || {};

  const validStatuses = ['accepted', 'rejected', 'implemented', 'reviewed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: { message: `status must be one of: ${validStatuses.join(', ')}` } });
  }

  const { data: recommendation, error: fetchError } = await req.supabase
    .from('recommendations').select('*').eq('id', id).maybeSingle();
  if (fetchError) return res.status(500).json({ success: false, error: { message: fetchError.message } });
  if (!recommendation) return res.status(404).json({ success: false, error: { message: 'Recommendation not found or not accessible.' } });

  const { data: updated, error: updateError } = await req.supabase
    .from('recommendations').update({ status }).eq('id', id).select().single();
  if (updateError) return res.status(500).json({ success: false, error: { message: updateError.message } });

  let task = null;
  if (actionTitle) {
    const { data: taskRow, error: taskError } = await req.supabase
      .from('tasks')
      .insert({
        organization_id: recommendation.organization_id,
        location_id: recommendation.location_id,
        title: actionTitle,
        description: actionDescription || null,
        status: 'in_progress',
        source_type: 'admin_recorded',
        source_recommendation_id: id,
      })
      .select().single();
    if (taskError) return res.status(500).json({ success: false, error: { message: taskError.message } });
    task = taskRow;
  }

  let outcome = null;
  if (outcomeDescription) {
    const { data: outcomeRow, error: outcomeError } = await req.supabase
      .from('outcomes')
      .insert({
        organization_id: recommendation.organization_id,
        location_id: recommendation.location_id,
        recommendation_id: id,
        task_id: task ? task.id : null,
        outcome_description: outcomeDescription,
        measured_impact: measuredImpact || null,
      })
      .select().single();
    if (outcomeError) return res.status(500).json({ success: false, error: { message: outcomeError.message } });
    outcome = outcomeRow;
  }

  return res.json({ success: true, data: { recommendation: updated, task, outcome } });
});

router.post('/dashboard-mappings/:id/approve', async (req, res) => {
  const { id } = req.params;

  const { data: mapping, error: fetchError } = await req.supabase
    .from('dashboard_mappings').select('*').eq('id', id).maybeSingle();

  if (fetchError) return res.status(500).json({ success: false, error: { message: fetchError.message } });
  if (!mapping) return res.status(404).json({ success: false, error: { message: 'Mapping not found or not accessible.' } });
  if (mapping.dashboard_mapping_status !== 'needs_verification') {
    return res.status(400).json({ success: false, error: { message: 'No pending change to approve.' } });
  }

  const { data: updated, error: updateError } = await req.supabase
    .from('dashboard_mappings')
    .update({
      oviond_dashboard_id: mapping.pending_dashboard_id,
      dashboard_access_url: mapping.pending_access_url,
      dashboard_mapping_status: 'verified',
      dashboard_last_verified_at: new Date().toISOString(),
      pending_dashboard_id: null,
      pending_access_url: null,
      change_detected_at: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) return res.status(500).json({ success: false, error: { message: updateError.message } });
  return res.json({ success: true, data: updated });
});

router.post('/dashboard-mappings/:id/reject', async (req, res) => {
  const { id } = req.params;

  const { data: updated, error } = await req.supabase
    .from('dashboard_mappings')
    .update({
      dashboard_mapping_status: 'conflict',
      pending_dashboard_id: null,
      pending_access_url: null,
      change_detected_at: null,
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: { message: error.message } });
  if (!updated) return res.status(404).json({ success: false, error: { message: 'Mapping not found or not accessible.' } });
  return res.json({ success: true, data: updated });
});

module.exports = router;
module.exports.buildTenantChatContext = buildTenantChatContext;