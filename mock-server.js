const http = require('http');
const fs = require('fs');
const path = require('path');

// Real Easley data, constructed from facts verified via direct SQL
// throughout tonight's session - not fabricated fantasy numbers.
const LOCATION_ID = '40000000-0000-0000-0000-000000000004';
const ORG_ID = '40000000-0000-0000-0000-000000000003';

const mainPayload = {
  location: { id: LOCATION_ID, name: 'BoxDrop Easley', organizations: { name: 'BoxDrop Easley' } },
  businessState: {
    state: {
      money: { status: 'STRONG', risk_flag: 'CHANNEL_CONCENTRATION', confidence: 'stale', fact: '$5130.19 real spend, 93% in Meta' },
      customer_intent: { status: 'IMPROVING', confidence: 'high', fact: 'Direction requests +90.7%, 28 real calls, 400 website clicks' },
      territory_mattress: { status: 'STRONG', category: 'mattress store', confidence: 'low', confidenceNote: 'Based on a single real territory grid run, not repeated observation.', fact: 'Real mattress store rank #1' },
      territory_furniture: { status: 'WEAK', category: 'furniture store', opportunity_confidence: 'HYPOTHESIS_NOT_PROVEN', confidence: 'low', confidenceNote: 'Based on a single real territory grid run, not repeated observation.', fact: 'Real furniture store rank #3 to #9 across real points checked' },
      competition: { status: 'INCOMPLETE_EVIDENCE', fact: '7 real competitors tracked' },
      reputation: { status: 'STRONG', fact: '4.7 avg across 7 recent reviews' },
      content: { status: 'OPPORTUNITY', confidence: 'SINGLE_OCCURRENCE', fact: 'Top real post: 2849 clicks' },
      store_outcome: { status: 'UNKNOWN', fact: 'No POS/sales connection exists' },
    },
    relationships: [
      { connects: ['money', 'customer_intent', 'store_outcome'], because: 'Real spend and real intent share the same unresolved question.' },
    ],
  },
  vantageState: { state: 'Watch' },
  investigations: [
    {
      id: 'c5a4bf39-f200-4592-956e-b5a5fcf48fe9',
      question: 'Why is real attention not converting at the usual real rate?',
      confidence: 'high', status: 'open',
      possible_explanations: [
        { explanation: 'Genuine performance gap between attention and conversion', supported_by: 'Real historical-low conversion z-score with high real attention volume' },
        { explanation: 'Measurement/attribution gap rather than an actual performance problem', supported_by: 'Real independent intent signals may not show the same decline' },
      ],
      evidence_against: [{ unknown: 'Real store outcome (did real walk-ins/sales actually decline)', evidence_needed: 'Real Store Pulse or POS data' }],
      next_check_at: '2026-08-31T00:00:00Z',
    },
  ],
  whatChanged: { realChangeCount: 2, changes: [{ clientFacingText: 'Real google clicks: meaningful_increase (current 535 vs real recent average 252.5)' }, { clientFacingText: 'Real organic engagement +33.2% period-over-period' }], territoryChangeNote: 'Not enough repeated real territory checks yet to detect a genuine rank trend.' },
  whatsNext: { whatHappensNext: 'Vantage is watching whether increased real attention (clicks, direction requests) begins converting at the normal real rate, or whether this is a genuine measurement gap.' },
  sourceInventory: {
    sources: [
      { source: 'Google Ads', connected: true, lastRealSync: '2026-08-23T02:06:56Z', stale: true },
      { source: 'Meta Ads', connected: true, lastRealSync: '2026-08-23T02:06:58Z', stale: true },
      { source: 'Google Business Profile', connected: true, lastRealData: '2026-07-01', stale: true },
      { source: 'Facebook Page (organic)', connected: true, lastRealData: '2026-07-01', stale: true },
      { source: 'Territory/SEO ranking', connected: true, lastRealData: '2026-08-22T20:09:43Z', stale: false },
      { source: 'Store outcomes (POS/spreadsheet)', connected: false, realCount: 0 },
    ],
    connectedCount: 7, totalPossible: 9,
  },
  recommendationTrackRecord: [
    { verdict: 'not_validated', reasoning: 'Owner confirmed directly this did not help.', source: 'client', judged_at: '2026-08-22T21:58:04Z', recommendations: { recommendation_text: 'Investigate what drove the July spike across channels' }, realStage: 'failed' },
  ],
  topPosts: [
    { caption: 'FURNITURE IS MOVING FAST! Shop local, save big, take it home TODAY with ZERO Down & 100 Days to Pay.', permalink: 'https://www.facebook.com/reel/4607331942835427/', image_url: 'https://scontent-iad3-1.xx.fbcdn.net/v/example.jpg', clicks: 2849, likes: 54, comments: 0, shares: 26, engagement_rate: 0.31 },
  ],
  investigations_count: 1,
  contradictions: { realContradictionCount: 0, summary: 'No real cross-source contradictions detected this period - sources are directionally consistent.' },
  dataQuality: { realIssueCount: 0, summary: 'No real data-quality issues detected.' },
  priorityItems: { topPriority: [{ category: 'constraint', severity: 'important', text: 'Real attention is up sharply but conversion is at a historical low - worth investigating before spending more on reach.' }] },
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/api/mc/organizations') {
    return respond(res, { success: true, data: [{ id: ORG_ID, name: 'BoxDrop Easley' }] });
  }
  if (req.url === `/api/mc/organizations/${ORG_ID}`) {
    return respond(res, { success: true, data: { locations: [{ id: LOCATION_ID, name: 'BoxDrop Easley' }] } });
  }
  if (req.url === `/api/mc/locations/${LOCATION_ID}`) {
    return respond(res, { success: true, data: mainPayload });
  }
  if (req.url.endsWith('/vantage-v44.html') || req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(fs.readFileSync(path.join(__dirname, 'public/vantage-v44.html'), 'utf8'));
  }
  res.statusCode = 404;
  res.end('{}');
});

function respond(res, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

server.listen(8899, () => console.log('Real mock server on :8899'));
