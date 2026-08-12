/**
 * Self-contained on purpose: doesn't depend on any shared controller
 * or error-handler that might not exist in the actual production
 * project. Only requireAdmin is shared.
 */

const express = require('express');
const supabase = require('../config/supabase');
const requireAdmin = require('../middleware/requireAdmin');
const aiService = require('../services/aiService');
const insightDataService = require('../services/insightDataService');
const { buildChannelComparison } = require('../utils/metrics');

const { ANALYSIS_TYPES, IMPLEMENTED_TYPES } = aiService;

const router = express.Router();

const inProgress = new Set();

function estimateCostUsd(usage) {
  if (!usage) return null;
  const inputCostPerM = 1.0;
  const outputCostPerM = 5.0;
  const inTokens = usage.input_tokens || 0;
  const outTokens = usage.output_tokens || 0;
  return (inTokens / 1_000_000) * inputCostPerM + (outTokens / 1_000_000) * outputCostPerM;
}

async function logUsage({ clientId, feature, question, modelName, usage }) {
  try {
    await supabase.from('ai_usage_log').insert({
      client_id: clientId,
      feature,
      question: question || null,
      model_name: modelName,
      input_tokens: usage ? usage.input_tokens : null,
      output_tokens: usage ? usage.output_tokens : null,
      estimated_cost_usd: estimateCostUsd(usage),
    });
  } catch (err) {
    console.error('Failed to log AI usage', { clientId, feature, reason: err.message });
  }
}

router.post('/clients/:id/generate-insight', requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({
      success: false,
      error: { message: `Invalid client id: "${id}". Expected a positive integer.` },
    });
  }
  const clientId = Number(id);

  if (inProgress.has(clientId)) {
    return res.status(409).json({
      success: false,
      error: { message: `A generation request for client ${clientId} is already in progress. Try again once it completes.` },
    });
  }
  inProgress.add(clientId);

  try {
    return await handleGenerateInsight(req, res, clientId);
  } finally {
    inProgress.delete(clientId);
  }
});

async function handleGenerateInsight(req, res, clientId) {
  const analysisType = (req.body && req.body.analysisType) || 'executive_summary';

  if (!ANALYSIS_TYPES.includes(analysisType)) {
    return res.status(400).json({
      success: false,
      error: { message: `Unknown analysisType "${analysisType}". Recognized types: ${ANALYSIS_TYPES.join(', ')}.` },
    });
  }
  if (!IMPLEMENTED_TYPES.has(analysisType)) {
    return res.status(501).json({
      success: false,
      error: { message: `analysisType "${analysisType}" is recognized but not implemented yet.` },
    });
  }

  try {
    const client = await insightDataService.getClientRecord(clientId);
    if (!client) {
      return res.status(404).json({ success: false, error: { message: `No client found with id ${clientId}` } });
    }

    const [snapshots, insights, provenContent, surveyResponses, periods, accountNotes, healthScore, servicesManaged, intelligenceFeed] = await Promise.all([
      insightDataService.getRecentSnapshots(clientId),
      insightDataService.getExistingInsights(clientId),
      insightDataService.getProvenContent(clientId),
      insightDataService.getSurveyResponses(clientId),
      insightDataService.getCurrentAndPreviousPeriods(clientId),
      insightDataService.getAccountNotes(clientId),
      insightDataService.getLatestHealthScore(clientId).catch(() => null),
      insightDataService.getServicesManaged(clientId).catch(() => []),
      insightDataService.getIntelligenceFeed(clientId).catch(() => []),
    ]);

    const [currentChannelRows, previousChannelRows] = await Promise.all([
      periods.current
        ? insightDataService.getChannelSnapshots(clientId, periods.current.period_start, periods.current.period_end)
        : [],
      periods.previous
        ? insightDataService.getChannelSnapshots(clientId, periods.previous.period_start, periods.previous.period_end)
        : [],
    ]);

    const channelComparisons = buildChannelComparison(currentChannelRows, previousChannelRows);

    let generated;
    try {
      generated = await aiService.generateInsight(
        { client, snapshots, insights, provenContent, surveyResponses, channelComparisons, accountNotes, healthScore, servicesManaged, intelligenceFeed },
        analysisType
      );
    } catch (aiErr) {
      console.error('generate-insight: structured output failed', { clientId, analysisType, reason: aiErr.message });
      return res.status(502).json({
        success: false,
        error: { message: `AI did not return a valid structured insight: ${aiErr.message}` },
      });
    }

    await logUsage({ clientId, feature: 'generate_insight', question: null, modelName: generated.model_name, usage: generated.usage });

    const latestSnapshot = snapshots[0];
    const periodStart = latestSnapshot ? latestSnapshot.period_start : null;
    const periodEnd = latestSnapshot ? latestSnapshot.period_end : null;

    const { data: savedRow, error: insertError } = await supabase
      .from('insights')
      .insert({
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        summary_text: generated.summary_text,
        what_worked: generated.what_worked,
        what_declined: generated.what_declined,
        recommended_next_steps: generated.recommended_next_steps,
        model_name: generated.model_name,
        prompt_version: generated.prompt_version,
      })
      .select()
      .single();

    if (insertError) {
      console.error('generate-insight: Supabase insert failed', { clientId, reason: insertError.message });
      return res.status(500).json({
        success: false,
        error: { message: `Insight generated but failed to save: ${insertError.message || 'unknown error'}` },
        data: { generated },
      });
    }

    return res.json({ success: true, data: savedRow });
  } catch (err) {
    console.error('generate-insight: unexpected error', { clientId, reason: err.message });
    return res.status(500).json({ success: false, error: { message: err.message || 'Internal server error' } });
  }
}

module.exports = router;
