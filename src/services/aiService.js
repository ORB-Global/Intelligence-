/**
 * Everything specific to calling an AI provider lives here. The route
 * never sees an API key, a model name, or a provider's request/response
 * shape — swap providers by changing only this file.
 */

const { getSystemPrompt, buildUserPrompt, ANALYSIS_TYPES, IMPLEMENTED_TYPES } = require('../config/insightPrompt');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const PROMPT_VERSION = process.env.INSIGHT_PROMPT_VERSION || 'v2';
const API_URL = 'https://api.anthropic.com/v1/messages';

if (!ANTHROPIC_API_KEY) {
  console.warn(
    'WARNING: ANTHROPIC_API_KEY is not set. POST /api/clients/:id/generate-insight will fail until it is added to .env.'
  );
}

const TOOL_NAME = 'submit_insight';

const INSIGHT_TOOL = {
  name: TOOL_NAME,
  description: 'Submit the structured 8-part account briefing. Every field must be present; use null for anything that does not apply.',
  input_schema: {
    type: 'object',
    properties: {
      overall_assessment: { type: 'string' },
      meta_performance: { type: ['string', 'null'] },
      google_performance: { type: ['string', 'null'] },
      period_over_period_changes: { type: ['string', 'null'] },
      strongest_performers: { type: ['string', 'null'] },
      weakest_performers_or_warnings: { type: ['string', 'null'] },
      recommended_actions: { type: ['string', 'null'] },
      client_questions: { type: ['string', 'null'] },
      missing_data: { type: ['string', 'null'] },
    },
    required: [
      'overall_assessment', 'meta_performance', 'google_performance', 'period_over_period_changes',
      'strongest_performers', 'weakest_performers_or_warnings', 'recommended_actions',
      'client_questions', 'missing_data',
    ],
    additionalProperties: false,
  },
};

const FIELD_LIMITS = {
  overall_assessment: 3000,
  meta_performance: 4000,
  google_performance: 4000,
  period_over_period_changes: 3000,
  strongest_performers: 2500,
  weakest_performers_or_warnings: 2500,
  recommended_actions: 4000,
  client_questions: 2500,
  missing_data: 3000,
};
const ALLOWED_FIELDS = Object.keys(FIELD_LIMITS);

function validateInsightPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Structured response missing or not an object.');
  }
  const unexpectedKeys = Object.keys(input).filter((key) => !ALLOWED_FIELDS.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Structured response contained unexpected field(s): ${unexpectedKeys.join(', ')}.`);
  }
  if (typeof input.overall_assessment !== 'string' || input.overall_assessment.trim().length === 0) {
    throw new Error('overall_assessment missing, empty, or not a string.');
  }
  for (const field of ALLOWED_FIELDS) {
    const value = input[field];
    if (field === 'overall_assessment') continue;
    if (value !== null && typeof value !== 'string') {
      throw new Error(`${field} must be a string or null, got ${typeof value}.`);
    }
    if (typeof value === 'string' && value.length > FIELD_LIMITS[field]) {
      throw new Error(`${field} exceeds ${FIELD_LIMITS[field]} characters.`);
    }
  }
  if (input.overall_assessment.length > FIELD_LIMITS.overall_assessment) {
    throw new Error(`overall_assessment exceeds ${FIELD_LIMITS.overall_assessment} characters.`);
  }
  return input;
}

/**
 * Maps the 8 structured-output fields down to the 4 text columns that
 * actually exist on `insights`. No new columns invented — this
 * mapping is the deliberate, documented compromise:
 *   summary_text           = overall_assessment + period_over_period_changes
 *   what_worked            = meta_performance + google_performance + strongest_performers
 *   what_declined          = weakest_performers_or_warnings
 *   recommended_next_steps = recommended_actions + client_questions
 *   missing_data is appended into summary_text, same as before.
 */
function mapToInsightColumns(v) {
  const summaryParts = [v.overall_assessment];
  if (v.period_over_period_changes) summaryParts.push(`PERIOD-OVER-PERIOD: ${v.period_over_period_changes}`);
  let summary_text = summaryParts.join('\n\n');
  if (v.missing_data) summary_text += `\n\nMISSING DATA NOTE: ${v.missing_data}`;

  const workedParts = [];
  if (v.meta_performance) workedParts.push(`META: ${v.meta_performance}`);
  if (v.google_performance) workedParts.push(`GOOGLE: ${v.google_performance}`);
  if (v.strongest_performers) workedParts.push(`STRONGEST: ${v.strongest_performers}`);
  const what_worked = workedParts.length ? workedParts.join('\n\n') : null;

  const what_declined = v.weakest_performers_or_warnings || null;

  const stepsParts = [];
  if (v.recommended_actions) stepsParts.push(v.recommended_actions);
  if (v.client_questions) stepsParts.push(`QUESTIONS FOR CLIENT: ${v.client_questions}`);
  const recommended_next_steps = stepsParts.length ? stepsParts.join('\n\n') : null;

  return { summary_text, what_worked, what_declined, recommended_next_steps };
}

async function generateInsight(data, analysisType = 'executive_summary') {
  if (!IMPLEMENTED_TYPES.has(analysisType)) {
    throw new Error(`Analysis type "${analysisType}" is not implemented.`);
  }
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const systemPrompt = getSystemPrompt(analysisType);
  const userPrompt = buildUserPrompt(data);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [INSIGHT_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    console.error('generate-insight: Anthropic API error', { status: res.status });
    throw new Error(`Anthropic API error ${res.status}: ${rawBody}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    throw new Error('Anthropic API returned a response that was not valid JSON.');
  }

  const toolUseBlock = (parsed.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUseBlock) {
    throw new Error('No structured tool_use response found in the AI output.');
  }

  const validated = validateInsightPayload(toolUseBlock.input);
  const columns = mapToInsightColumns(validated);

  return {
    ...columns,
    model_name: MODEL,
    prompt_version: PROMPT_VERSION,
    usage: parsed.usage || null,
  };
}

module.exports = { generateInsight, ANALYSIS_TYPES, IMPLEMENTED_TYPES, validateInsightPayload, mapToInsightColumns };

