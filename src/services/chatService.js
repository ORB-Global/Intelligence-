const { buildChatUserPrompt, getSystemPrompt } = require('../config/chatPrompt');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const TOOL_NAME = 'submit_answer';
const MAX_RESPONSE_TOKENS = 1200; // smaller than insight generation - chat answers should be concise

const ANSWER_TOOL = {
  name: TOOL_NAME,
  description: 'Submit the structured answer to the staff question.',
  input_schema: {
    type: 'object',
    properties: {
      findings: { type: 'string' },
      evidence: { type: ['string', 'null'] },
      recommended_actions: { type: ['string', 'null'] },
      insufficient_data: { type: ['string', 'null'] },
      suggested_action: {
        type: ['object', 'null'],
        description: 'Only set this when the answer would genuinely benefit from opening a real, structured view instead of just text - never set it speculatively.',
        properties: {
          type: { type: 'string', enum: ['show_search_opportunities', 'show_keyword_evidence', 'open_where_you_stand', 'show_review_chain', 'ask_store_pulse', 'open_investigation'] },
          competitor_name: { type: ['string', 'null'], description: 'Only for open_where_you_stand or show_keyword_evidence when scoped to one named competitor.' },
          investigation_id: { type: ['string', 'null'], description: 'Only for open_investigation - the real investigation id already in context, never invented.' },
        },
        required: ['type'],
      },
    },
    required: ['findings', 'evidence', 'recommended_actions', 'insufficient_data', 'suggested_action'],
    additionalProperties: false,
  },
};

const FIELD_LIMITS = { findings: 3000, evidence: 3000, recommended_actions: 2000, insufficient_data: 1500 };

function validateAnswerPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Structured response missing or not an object.');
  }
  // Defensive coercion: the model can slip into non-string shapes for
  // these two fields in predictable ways. Handle every shape actually
  // observed rather than just one - a narrow fix (array-of-strings
  // only) was tried first and the same failure recurred with a
  // different shape, so this covers arrays of any content and plain
  // objects by extracting/stringifying rather than hard-failing.
  for (const field of ['recommended_actions', 'insufficient_data']) {
    const value = input[field];
    if (Array.isArray(value)) {
      input[field] = value.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    } else if (value !== null && typeof value === 'object') {
      input[field] = Object.values(value).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    }
  }
  const allowed = [...Object.keys(FIELD_LIMITS), 'suggested_action'];
  const unexpected = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unexpected.length) throw new Error(`Unexpected field(s): ${unexpected.join(', ')}.`);
  if (typeof input.findings !== 'string' || input.findings.trim().length === 0) {
    throw new Error('findings missing, empty, or not a string.');
  }
  for (const field of Object.keys(FIELD_LIMITS)) {
    const value = input[field];
    if (field === 'findings') continue;
    if (value !== null && typeof value !== 'string') throw new Error(`${field} must be a string or null.`);
    if (typeof value === 'string' && value.length > FIELD_LIMITS[field]) {
      throw new Error(`${field} exceeds ${FIELD_LIMITS[field]} characters.`);
    }
  }
  if (input.findings.length > FIELD_LIMITS.findings) throw new Error(`findings exceeds ${FIELD_LIMITS.findings} characters.`);
  const VALID_ACTION_TYPES = ['show_search_opportunities', 'show_keyword_evidence', 'open_where_you_stand', 'show_review_chain', 'ask_store_pulse', 'open_investigation'];
  if (input.suggested_action) {
    if (typeof input.suggested_action !== 'object' || !VALID_ACTION_TYPES.includes(input.suggested_action.type)) {
      throw new Error('suggested_action present but malformed.');
    }
  }
  return input;
}

async function askQuestion(context, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const userPrompt = buildChatUserPrompt(context);
  const systemPrompt = getSystemPrompt(Boolean(options.tenantMode));

  // conversationHistory: prior turns from a persisted conversation
  // (tenant mode only - the old admin path has none). Kept small by
  // the caller, not dumped in full.
  const priorMessages = (options.conversationHistory || []).map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? m.content : m.content,
  }));

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_RESPONSE_TOKENS,
      system: systemPrompt,
      messages: [...priorMessages, { role: 'user', content: userPrompt }],
      tools: [ANSWER_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    console.error('chat: Anthropic API error', { status: res.status });
    throw new Error(`Anthropic API error ${res.status}: ${rawBody}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    throw new Error('Anthropic API returned a response that was not valid JSON.');
  }

  const toolUseBlock = (parsed.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUseBlock) throw new Error('No structured tool_use response found in the AI output.');

  const validated = validateAnswerPayload(toolUseBlock.input);

  return { answer: validated, model_name: MODEL, usage: parsed.usage || null };
}

module.exports = { askQuestion, MODEL };

