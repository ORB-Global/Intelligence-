// server/push.js → copy to src/routes/push.js in orb-intelligence and mount:
//   app.use('/api/push', require('./src/routes/push'));
const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

router.post('/register', express.json(), async (req, res) => {
  const auth = req.headers.authorization || ''; const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session expired' });
  const { device_token, platform = 'ios', location_id } = req.body || {};
  if (!device_token) return res.status(400).json({ error: 'device_token required' });
  const { error: e2 } = await supabase.from('push_devices')
    .upsert({ user_id: user.id, platform, device_token, location_id: location_id || null, enabled: true, last_seen_at: new Date().toISOString() }, { onConflict: 'platform,device_token' });
  if (e2) return res.status(500).json({ error: e2.message });
  res.json({ ok: true });
});
module.exports = router;
