#!/usr/bin/env node
// scripts/judgeRecommendations.js — nightly; writes a verdict for any recommendation that was acted on 30+ days ago.
require('dotenv').config();
const supabase = require('../src/config/supabase');
supabase.rpc('judge_recommendations').then(({ data, error }) => {
  if (error) { console.error(error.message); process.exit(1); }
  console.log(new Date().toISOString(), 'judged', data, 'recommendation(s)');
});
