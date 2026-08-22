#!/usr/bin/env node
/**
 * Formal cold-vs-learned A/B test. Same location, same current raw
 * evidence, same 5 questions, same model - the ONLY variable toggled
 * is whether accumulated Business Model context (beliefs, judgments,
 * memory, investigations, oversight cadence) is included.
 *
 * Real cost: 10 real Anthropic calls (5 questions x 2 conditions).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const chatService = require('../src/services/chatService');
const { buildTenantChatContext } = require('../src/routes/missionControl');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EASLEY_ID = '40000000-0000-0000-0000-000000000004';

const QUESTIONS = [
  'What matters most right now?',
  'Should I be worried?',
  'What opportunity am I missing?',
  'What should I do?',
  'Have you seen anything like this before?',
];

function stripBusinessModel(context) {
  // Real "cold" condition: removes ONLY the accumulated-intelligence
  // fields, keeps all raw current evidence identical.
  return {
    ...context,
    activeBeliefs: [],
    currentJudgments: [],
    businessMemory: [],
    investigations: [],
    oversightCadence: null,
  };
}

async function main() {
  console.log('Building real Easley context...\n');
  const fullContext = await buildTenantChatContext(supabase, EASLEY_ID);
  const coldContext = stripBusinessModel(fullContext);

  for (const question of QUESTIONS) {
    console.log(`\n${'='.repeat(70)}\nQ: "${question}"\n${'='.repeat(70)}`);

    console.log('\n--- COLD (no Business Model) ---');
    try {
      const coldResult = await chatService.askQuestion({ ...coldContext, question }, { tenantMode: true, conversationHistory: [] });
      console.log('FINDINGS:', coldResult.answer.findings);
      console.log('EVIDENCE:', coldResult.answer.evidence);
    } catch (err) { console.error('COLD FAILED:', err.message); }

    console.log('\n--- LEARNED (full Business Model) ---');
    try {
      const learnedResult = await chatService.askQuestion({ ...fullContext, question }, { tenantMode: true, conversationHistory: [] });
      console.log('FINDINGS:', learnedResult.answer.findings);
      console.log('EVIDENCE:', learnedResult.answer.evidence);
    } catch (err) { console.error('LEARNED FAILED:', err.message); }
  }
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
