#!/usr/bin/env node
// scripts/sendMorningBriefs.js — runs every 15 min from cron; texts the morning brief to whoever is due.
require('dotenv').config();
const supabase = require('../src/config/supabase');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { data: due, error } = await supabase.rpc('morning_briefs_due', { p_window_minutes: 15 });
  if (error) { console.error('morning_briefs_due failed:', error.message); process.exit(1); }
  if (!due?.length) { console.log(new Date().toISOString(), 'nobody due'); return; }
  const client = dryRun ? null : require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  for (const c of due) {
    try {
      if (dryRun) console.log('[dry-run]', c.phone, c.message);
      else { const m = await client.messages.create({ to: c.phone, from: process.env.TWILIO_FROM, body: c.message }); console.log('sent', c.phone, m.sid); }
      await supabase.from('checkin_contacts').update({ last_brief_sent_at: new Date().toISOString() }).eq('id', c.contact_id);
    } catch (e) { console.error('send failed', c.phone, e.message); }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
