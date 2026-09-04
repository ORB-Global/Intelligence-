// src/routes/try.js
// Public (no login) — the booth "try it" page posts here.
//   app.use('/api/try', require('./src/routes/try'));
//   app.get('/try', (req, res) => res.sendFile(path.join(__dirname, 'public/try.html')));
//   app.get('/try/:token', (req, res) => res.sendFile(path.join(__dirname, 'public/try.html'))); // report view — later

const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

// very light rate limit: 20 submissions per IP per hour (booth wifi is shared, so keep it generous)
const hits = new Map();
function limit(req, res, next) {
  const k = req.ip, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 20) return res.status(429).json({ error: 'Too many tries from this connection — find us at the booth.' });
  arr.push(now); hits.set(k, arr); next();
}

router.post('/', express.json(), limit, async (req, res) => {
  const b = req.body || {};
  if (!b.address || !b.city || !b.state) return res.status(400).json({ error: 'Address, city and state are required' });
  const clean = s => (s == null ? null : String(s).trim().slice(0, 200) || null);

  const { data, error } = await supabase.rpc('create_prospect_session', {
    p_address: clean(b.address), p_business_type: clean(b.business_type) || 'mattress & furniture',
    p_business_name: clean(b.business_name), p_city: clean(b.city), p_state: clean(b.state)?.toUpperCase(), p_zip: clean(b.zip),
    p_lat: null, p_lng: null,
    p_contact_name: clean(b.contact_name), p_contact_email: clean(b.contact_email), p_contact_phone: clean(b.contact_phone),
    p_source: clean(b.source) || 'conference_booth',
  });
  if (error) return res.status(500).json({ error: error.message });
  const row = Array.isArray(data) ? data[0] : data;
  // Only return what the page needs — never the contact fields
  res.status(201).json({ token: row.token, benchmark_json: row.benchmark_json, state: row.state });
});

// Later: GET /:token returns the enriched report (weather, competitors, briefing) once the server fills it in.
router.get('/:token', async (req, res) => {
  const { data, error } = await supabase.from('prospect_sessions')
    .select('token,business_name,business_type,city,state,benchmark_json,weather_json,competitors_json,briefing,status,created_at')
    .eq('token', req.params.token).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'This report link has expired' });
  res.json(data);
});

module.exports = router;
