#!/usr/bin/env node
/**
 * Real, non-destructive test of the Ask Vantage control-surface
 * mechanism - calls chatService.askQuestion() DIRECTLY with real
 * Easley context, bypassing HTTP/Express/auth entirely. This is the
 * safest way to test the underlying service without touching
 * production authentication, per the explicit instruction.
 *
 * Real cost: 5 real Anthropic API calls (Tests A-E). No writes to
 * production data except real, intentional test messages into
 * ai_conversations (same as a real user would create).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const chatService = require('../src/services/chatService');
const { buildTenantChatContext } = require('../src/routes/missionControl');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EASLEY_ID = '40000000-0000-0000-0000-000000000004';

const TESTS = [
  { name: 'TEST A - keyword competition', question: 'Who is beating me on keywords and where am I losing ground?' },
  { name: 'TEST B - Orb activity', question: 'What has Orb done recently?' },
  { name: 'TEST D - keyword priorities', question: 'What keywords should I care about?' },
  { name: 'TEST E - store reality', question: 'How was the store this week?' },
];

async function main() {
  console.log(`Building real Easley context...\n`);
  const context = await buildTenantChatContext(supabase, EASLEY_ID);

  for (const test of TESTS) {
    console.log(`\n${'='.repeat(60)}\n${test.name}\nQ: "${test.question}"\n${'='.repeat(60)}`);
    try {
      const result = await chatService.askQuestion({ ...context, question: test.question }, { tenantMode: true, conversationHistory: [] });
      console.log('FINDINGS:', result.answer.findings);
      console.log('EVIDENCE:', result.answer.evidence);
      console.log('SUGGESTED_ACTION:', JSON.stringify(result.answer.suggested_action));
    } catch (err) {
      console.error('FAILED:', err.message);
    }
  }

  // TEST C requires a real investigation anchor - use the real one
  // that exists for Easley.
  const { data: inv } = await supabase.from('investigations').select('id, question').eq('location_id', EASLEY_ID).eq('status', 'investigating').limit(1).maybeSingle();
  if (inv) {
    console.log(`\n${'='.repeat(60)}\nTEST C - investigation context anchor\nAnchored to real investigation: "${inv.question}"\nQ: "Did this happen before?"\n${'='.repeat(60)}`);
    const anchoredContext = { ...context };
    const anchored = (context.investigations || []).find((i) => i.id === inv.id);
    if (anchored) anchoredContext.anchoredInvestigation = anchored;
    try {
      const result = await chatService.askQuestion({ ...anchoredContext, question: 'Did this happen before?' }, { tenantMode: true, conversationHistory: [] });
      console.log('FINDINGS:', result.answer.findings);
      console.log('SUGGESTED_ACTION:', JSON.stringify(result.answer.suggested_action));
    } catch (err) {
      console.error('FAILED:', err.message);
    }
  } else {
    console.log('\nTEST C skipped - no real open investigation exists for Easley right now.');
  }
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
