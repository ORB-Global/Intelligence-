/**
 * Security note on "don't trust a client ID typed into the browser":
 * this route reads the client id ONLY from the URL path parameter
 * (:id), which requireAdmin has already gated. It never reads a
 * client id from the request body. There is no way for the browser
 * to ask for client X's data while claiming to be about client Y —
 * whatever :id is in the URL is the only client this handler will
 * ever fetch data for.
 *
 * There is no per-staff-user identity in this system yet (see the
 * auth section from earlier tonight) - requireAdmin verifies "is this
 * a holder of the shared admin secret," not "which staff member is
 * this." That gap still exists; flagged, not fixed here.
 */

const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const insightDataService = require('../services/insightDataService');
const chatService = require('../services/chatService');
const { buildChannelComparison } = require('../utils/metrics');
const supabase = require('../config/supabase');

const router = express.Router();

const MAX_QUESTION_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function logUsage({ clientId, question, modelName, usage }) {
  try {
    const inputCostPerM = 1.0;
    const outputCostPerM = 5.0;
    const inTokens = usage ? usage.input_tokens || 0 : 0;
    const outTokens = usage ? usage.output_tokens || 0 : 0;
    const estimated_cost_usd = usage
      ? (inTokens / 1_000_000) * inputCostPerM + (outTokens / 1_000_000) * outputCostPerM
      : null;

    await supabase.from('ai_usage_log').insert({
      client_id: clientId,
      feature: 'chat',
      question,
      model_name: modelName,
      input_tokens: usage ? usage.input_tokens : null,
      output_tokens: usage ? usage.output_tokens : null,
      estimated_cost_usd,
    });
  } catch (err) {
    console.error('Failed to log chat usage', { clientId, reason: err.message });
  }
}

router.post('/clients/:id/ask', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ success: false, error: { message: `Invalid client id: "${id}".` } });
  }
  const clientId = Number(id);

  const question = req.body && typeof req.body.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    return res.status(400).json({ success: false, error: { message: 'question is required.' } });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      success: false,
      error: { message: `question exceeds ${MAX_QUESTION_LENGTH} characters.` },
    });
  }

  const { start, end } = (req.body && req.body.dateRange) || {};
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return res.status(400).json({
      success: false,
      error: { message: 'dateRange.start and dateRange.end are required, format YYYY-MM-DD.' },
    });
  }

  try {
    const client = await insightDataService.getClientRecord(clientId);
    if (!client) {
      return res.status(404).json({ success: false, error: { message: `No client found with id ${clientId}` } });
    }

    // Fetch everything scoped to this client + date range. This
    // re-fetches from Supabase on every question - deliberately no
    // server-side caching yet, keeps the "current data only" guarantee
    // simple at the cost of an extra round-trip per question.
    const [snapshots, insights, accountNotes] = await Promise.all([
      insightDataService.getRecentSnapshots(clientId, 6), // capped - cost control, not the full history
      insightDataService.getExistingInsights(clientId, 3),
      insightDataService.getAccountNotes(clientId, 10),
    ]);

    const inRangeSnapshots = snapshots.filter((s) => s.period_start >= start && s.period_end <= end);
    const relevantSnapshot = inRangeSnapshots[0] || snapshots[0] || null;
    const previousSnapshot = snapshots.find((s) => relevantSnapshot && s.period_start < relevantSnapshot.period_start) || null;

    const [currentChannelRows, previousChannelRows] = await Promise.all([
      relevantSnapshot
        ? insightDataService.getChannelSnapshots(clientId, relevantSnapshot.period_start, relevantSnapshot.period_end)
        : [],
      previousSnapshot
        ? insightDataService.getChannelSnapshots(clientId, previousSnapshot.period_start, previousSnapshot.period_end)
        : [],
    ]);

    const channelComparisons = buildChannelComparison(currentChannelRows, previousChannelRows);

    let result;
    try {
      result = await chatService.askQuestion({
        question,
        dateRange: { start, end },
        client,
        channelComparisons,
        snapshots: inRangeSnapshots.length ? inRangeSnapshots : snapshots.slice(0, 2),
        accountNotes,
        insights,
      });
    } catch (aiErr) {
      console.error('chat: structured output failed', { clientId, reason: aiErr.message });
      return res.status(502).json({
        success: false,
        error: { message: `AI did not return a valid structured answer: ${aiErr.message}` },
      });
    }

    await logUsage({ clientId, question, modelName: result.model_name, usage: result.usage });

    return res.json({
      success: true,
      data: {
        answer: result.answer,
        dataScope: {
          client: client.client_name,
          dateRange: { start, end },
          channelsIncluded: channelComparisons.map((c) => ({ channel: c.channel, status: c.status })),
          snapshotsIncluded: inRangeSnapshots.length || (snapshots.length ? 1 : 0),
          previousPeriodAvailable: Boolean(previousSnapshot),
          accountNotesIncluded: accountNotes.length,
        },
      },
    });
  } catch (err) {
    console.error('chat: unexpected error', { clientId, reason: err.message });
    return res.status(500).json({ success: false, error: { message: err.message || 'Internal server error' } });
  }
});

module.exports = router;

