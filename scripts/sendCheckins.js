#!/usr/bin/env node
// scripts/sendCheckins.js
// Runs every 15 minutes from cron. Asks the database who is due a
// "How was today?" text right now (in each store's own time zone) and sends it.
//
// Env needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number, E.164)
// plus the existing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the app already uses.

require('dotenv').config();
const supabase = require('../src/config/supabase');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { data: due, error } = await supabase.rpc('checkins_due', { p_window_minutes: 15 });
  if (error) { console.error('checkins_due failed:', error.message); process.exit(1); }
  if (!due?.length) { console.log(new Date().toISOString(), 'nobody due'); return; }

  let client = null;
  if (!dryRun) {
    const twilio = require('twilio');
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }

  for (const c of due) {
    try {
      if (dryRun) {
        console.log('[dry-run] would text', c.phone, `(${c.location_name}):`, c.message);
      } else {
        const msg = await client.messages.create({ to: c.phone, from: process.env.TWILIO_FROM, body: c.message });
        console.log('sent', c.location_name, c.phone, msg.sid);
      }
      await supabase.from('checkin_contacts').update({ last_sent_at: new Date().toISOString() }).eq('id', c.contact_id);
    } catch (e) {
      console.error('send failed', c.location_name, c.phone, e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
