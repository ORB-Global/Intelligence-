// src/routes/vantage.js
// Client-facing routes for the four screens. Mount in server.js:
//   app.use('/api/vantage', require('./src/routes/vantage'));
//
// Auth: the page sends the owner's Supabase access token as a Bearer header.
// We verify it and check location_memberships before touching any data.
// (Service-role client bypasses RLS, so this check is what enforces tenancy.)

const express = require('express');
const supabase = require('../config/supabase'); // existing service-role client
const router = express.Router();

async function requireLocation(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in required' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Session expired — sign in again' });

    const locationId = req.params.locationId || req.body?.location_id;
    if (!locationId) return res.status(400).json({ error: 'location_id required' });

    // Orb staff can see any location; owners only theirs.
    const { data: role } = await supabase.from('platform_roles').select('role').eq('user_id', user.id).maybeSingle();
    const isStaff = role && ['super_admin', 'orb_admin', 'orb_staff'].includes(role.role);
    if (!isStaff) {
      const { data: m } = await supabase.from('location_memberships')
        .select('id').eq('user_id', user.id).eq('location_id', locationId).maybeSingle();
      if (!m) return res.status(403).json({ error: 'You don’t have access to this store' });
    }
    req.user = user; req.locationId = locationId; req.isStaff = !!isStaff;
    next();
  } catch (e) { next(e); }
}

// ---- Home payload: everything the four screens need in one call
router.get('/home/:locationId', requireLocation, async (req, res) => {
  const { data, error } = await supabase.rpc('vantage_home', { p_location_id: req.locationId });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---- Daily check-in from the app (the SMS path lands in twilio.js)
router.post('/checkin/:locationId', requireLocation, async (req, res) => {
  const { mood, sales_count, revenue, note, checkin_date } = req.body || {};
  if (mood != null && !(mood >= 1 && mood <= 5)) return res.status(400).json({ error: 'mood must be 1–5' });

  const { data: loc } = await supabase.from('locations').select('timezone').eq('id', req.locationId).single();
  const tz = loc?.timezone || 'America/New_York';
  const today = checkin_date || new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD in store's zone

  const row = {
    location_id: req.locationId, checkin_date: today, source: 'app',
    ...(mood != null && { mood }), ...(sales_count != null && { sales_count }),
    ...(revenue != null && { revenue }), ...(note && { note }),
    answered_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('daily_checkins')
    .upsert(row, { onConflict: 'location_id,checkin_date' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---- Lead log
router.get('/leads/:locationId', requireLocation, async (req, res) => {
  const status = req.query.status; // optional filter
  let q = supabase.from('lead_events').select('*').eq('location_id', req.locationId).order('occurred_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/leads/:locationId', requireLocation, async (req, res) => {
  const b = req.body || {};
  const { data, error } = await supabase.from('lead_events').insert({
    location_id: req.locationId,
    source: b.source || 'other', external_id: b.external_id || null,
    occurred_at: b.occurred_at || new Date().toISOString(),
    contact_name: b.contact_name, contact_phone: b.contact_phone, contact_email: b.contact_email,
    first_message: b.first_message, ad_id: b.ad_id, ad_name: b.ad_name, campaign_name: b.campaign_name,
    product_interest: b.product_interest, notes: b.notes, updated_by: req.isStaff ? 'orb' : 'owner',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// one-tap status change: Talking / Sold / Lost
router.post('/leads/:leadId/status', async (req, res, next) => {
  // look up the lead's location first so requireLocation can check access
  const { data: lead, error } = await supabase.from('lead_events').select('location_id').eq('id', req.params.leadId).single();
  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });
  req.params.locationId = lead.location_id;
  requireLocation(req, res, async () => {
    const { status, sale_amount, sale_items, lost_reason } = req.body || {};
    if (!['new', 'talking', 'appointment', 'sold', 'lost', 'spam'].includes(status)) return res.status(400).json({ error: 'bad status' });
    const { data, error: e2 } = await supabase.rpc('set_lead_status', {
      p_lead_id: req.params.leadId, p_status: status, p_sale_amount: sale_amount ?? null,
      p_sale_items: sale_items ?? null, p_lost_reason: lost_reason ?? null, p_by: req.isStaff ? 'orb' : 'owner',
    });
    if (e2) return res.status(500).json({ error: e2.message });
    res.json(data);
  });
});

// ---- Ledger / funnel for a custom range (Sales screen "see more")
router.get('/ledger/:locationId', requireLocation, async (req, res) => {
  const days = Math.min(90, Number(req.query.days) || 30);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('vantage_daily_ledger').select('*')
    .eq('location_id', req.locationId).gte('day', since).order('day');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/funnel/:locationId', requireLocation, async (req, res) => {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('vantage_ad_funnel', { p_location_id: req.locationId, p_from: from, p_to: to });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---- Owner approves an ad ("yes, run it") → lands in Orb's approval queue
router.post('/creatives/:jobId/approve', async (req, res) => {
  const { data: job } = await supabase.from('creative_jobs').select('location_id').eq('id', req.params.jobId).single();
  if (!job) return res.status(404).json({ error: 'Ad not found' });
  req.params.locationId = job.location_id;
  requireLocation(req, res, async () => {
    const { data, error } = await supabase.rpc('approve_creative', { p_job_id: req.params.jobId, p_by: req.isStaff ? 'orb' : 'owner', p_note: req.body?.note || null });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });
});

// ---- Owner responds to a recommendation: acted_on | declined | acknowledged
router.post('/recommendations/:recId/respond', async (req, res) => {
  const { data: rec } = await supabase.from('recommendations').select('location_id').eq('id', req.params.recId).single();
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  req.params.locationId = rec.location_id;
  requireLocation(req, res, async () => {
    const { data, error } = await supabase.rpc('respond_to_recommendation', { p_rec_id: req.params.recId, p_action: req.body?.action, p_note: req.body?.note || null });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });
});

module.exports = router;
