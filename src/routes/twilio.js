// src/routes/twilio.js
// Twilio posts here when an owner texts back. Mount in server.js:
//   app.use('/api/sms', require('./src/routes/twilio'));
// Then in the Twilio console, set the number's "A message comes in" webhook to
//   https://<your-domain>/api/sms/inbound   (HTTP POST)

const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

// Twilio sends form-encoded bodies
router.use(express.urlencoded({ extended: false }));

// Verify the request really came from Twilio (skip only if TWILIO_AUTH_TOKEN is unset in dev)
function verifyTwilio(req, res, next) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return next();
  try {
    const twilio = require('twilio');
    const url = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`) + req.originalUrl;
    const ok = twilio.validateRequest(token, req.headers['x-twilio-signature'] || '', url, req.body);
    if (!ok) return res.status(403).send('bad signature');
  } catch (e) { console.error('twilio verify failed', e.message); return res.status(500).send('verify error'); }
  next();
}

const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Message></Response>`;

router.post('/inbound', verifyTwilio, async (req, res) => {
  const from = req.body.From;           // E.164
  const body = (req.body.Body || '').trim();
  res.type('text/xml');

  if (/^(stop|unsubscribe|cancel|quit)$/i.test(body)) {
    await supabase.from('checkin_contacts').update({ opted_in: false }).eq('phone', from);
    return res.send(twiml('Got it — no more check-in texts. Reply START anytime to turn them back on.'));
  }
  if (/^start$/i.test(body)) {
    await supabase.from('checkin_contacts').update({ opted_in: true }).eq('phone', from);
    return res.send(twiml('Welcome back. We’ll check in each evening.'));
  }

  const { data, error } = await supabase.rpc('record_checkin_reply', { p_phone: from, p_text: body, p_received_at: new Date().toISOString() });
  if (error) {
    console.error('record_checkin_reply', error.message);
    if (/unknown phone/.test(error.message)) return res.send(twiml('This number isn’t set up for Vantage check-ins yet. Ask Orb to add you.'));
    return res.send(twiml('Didn’t catch that. Try a number 1–5 and how many sales, like "4, 3 sales".'));
  }

  const row = Array.isArray(data) ? data[0] : data;
  const moodWord = ['', 'a dead day', 'a slow day', 'an okay day', 'a good day', 'a great day'][row?.mood] || 'your day';
  const salesBit = row?.sales_count != null ? ` and ${row.sales_count} sale${row.sales_count === 1 ? '' : 's'}` : '';
  const ask = row?.mood == null ? ' How would you rate it, 1–5?' : row?.sales_count == null ? ' How many sales?' : '';
  return res.send(twiml(`Logged ${moodWord}${salesBit}. Thanks.${ask}`));
});

module.exports = router;
