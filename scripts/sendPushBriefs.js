#!/usr/bin/env node
// server/sendPushBriefs.js → copy to scripts/sendPushBriefs.js. Every 15 min from cron.
// Needs an APNs auth key from developer.apple.com (Keys → + → Apple Push Notifications service).
// Env: APNS_KEY_PATH=./AuthKey_XXXX.p8  APNS_KEY_ID=XXXX  APNS_TEAM_ID=YYYY  APNS_BUNDLE_ID=com.orbglobal.vantage  APNS_PRODUCTION=true
require('dotenv').config();
const apn = require('@parse/node-apn');
const supabase = require('../src/config/supabase');

async function main() {
  const { data: due, error } = await supabase.rpc('push_briefs_due', { p_window_minutes: 15 });
  if (error) throw error;
  if (!due?.length) { console.log(new Date().toISOString(), 'nobody due'); return; }
  const provider = new apn.Provider({
    token: { key: process.env.APNS_KEY_PATH, keyId: process.env.APNS_KEY_ID, teamId: process.env.APNS_TEAM_ID },
    production: process.env.APNS_PRODUCTION === 'true',
  });
  for (const d of due) {
    const note = new apn.Notification({ alert: { title: 'Your morning brief', body: d.message.replace(' Open Vantage for the full story.', '') },
      sound: 'default', topic: process.env.APNS_BUNDLE_ID, payload: { url: '/vantage-home.html' } });
    const r = await provider.send(note, d.device_token);
    if (r.failed?.length) { console.error('failed', d.device_token.slice(0, 8), r.failed[0].response); if (r.failed[0].status === '410') await supabase.from('push_devices').update({ enabled: false }).eq('id', d.device_id); }
    else console.log('pushed', d.device_token.slice(0, 8));
    await supabase.from('push_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', d.device_id);
  }
  provider.shutdown();
}
main().catch(e => { console.error(e); process.exit(1); });
