// src/routes/portfolio.js
//   app.use('/api/portfolio', require('./src/routes/portfolio'));
// Returns the stores the signed-in user may see (coach → their stores, leadership/staff → all).

const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

async function requireUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session expired — sign in again' });
  req.user = user; next();
}

router.get('/', requireUser, async (req, res) => {
  const [{ data: locations, error }, { data: role }] = await Promise.all([
    supabase.rpc('vantage_portfolio', { p_user: req.user.id }),
    supabase.from('platform_roles').select('role').eq('user_id', req.user.id).maybeSingle(),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const isNetwork = role && ['super_admin', 'orb_admin', 'orb_staff', 'leadership'].includes(role.role);
  let network = null;
  if (isNetwork) {
    const { data } = await supabase.rpc('vantage_network_summary');
    network = data;
  }
  res.json({ scope: isNetwork ? 'network' : 'group', locations: locations || [], network });
});

// Orb staff: approved ads waiting to be posted
router.get('/approval-queue', requireUser, async (req, res) => {
  const { data: role } = await supabase.from('platform_roles').select('role').eq('user_id', req.user.id).maybeSingle();
  if (!role || !['super_admin', 'orb_admin', 'orb_staff'].includes(role.role)) return res.status(403).json({ error: 'Orb staff only' });
  const { data, error } = await supabase.from('orb_approval_queue').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Orb staff: mark an approved ad as posted (closes the loop, starts the 30-day measurement)
router.post('/creatives/:jobId/posted', requireUser, express.json(), async (req, res) => {
  const { data: role } = await supabase.from('platform_roles').select('role').eq('user_id', req.user.id).maybeSingle();
  if (!role || !['super_admin', 'orb_admin', 'orb_staff'].includes(role.role)) return res.status(403).json({ error: 'Orb staff only' });
  const { data, error } = await supabase.rpc('mark_creative_posted', { p_job_id: req.params.jobId, p_posted_ad_id: req.body?.posted_ad_id || null, p_by: req.user.email || 'orb' });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
