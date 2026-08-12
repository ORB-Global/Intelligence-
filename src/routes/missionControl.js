/**
 * Every route here uses req.supabase (the per-user, RLS-scoped client
 * from requireSupabaseAuth), never the service-role client. This is
 * deliberate: authorization is enforced by the database policies
 * already tested extensively, not re-implemented in application code.
 * If a query returns nothing, it's because RLS said so.
 */

const express = require('express');
const requireSupabaseAuth = require('../middleware/requireSupabaseAuth');

const router = express.Router();
router.use(requireSupabaseAuth);

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

  const [
    { data: location, error: locError },
    { data: connections, error: connError },
    { data: mapping, error: mapError },
    { data: metrics, error: metricsError },
    { data: feed, error: feedError },
  ] = await Promise.all([
    req.supabase.from('locations').select('*, organizations(name)').eq('id', id).maybeSingle(),
    req.supabase.from('connection_health').select('*').eq('location_id', id).order('channel'),
    req.supabase.from('dashboard_mappings').select('*').eq('location_id', id).maybeSingle(),
    req.supabase.from('historical_metrics').select('*').eq('location_id', id).order('period_start', { ascending: false }),
    req.supabase.from('intelligence_feed').select('*').eq('location_id', id).order('occurred_at', { ascending: false }),
  ]);

  if (locError) return res.status(500).json({ success: false, error: { message: locError.message } });
  if (!location) return res.status(404).json({ success: false, error: { message: 'Location not found or not accessible.' } });
  if (connError) return res.status(500).json({ success: false, error: { message: connError.message } });
  if (mapError) return res.status(500).json({ success: false, error: { message: mapError.message } });
  if (metricsError) return res.status(500).json({ success: false, error: { message: metricsError.message } });
  if (feedError) return res.status(500).json({ success: false, error: { message: feedError.message } });

  return res.json({
    success: true,
    data: { location, connections: connections || [], mapping: mapping || null, metrics: metrics || [], feed: feed || [] },
  });
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