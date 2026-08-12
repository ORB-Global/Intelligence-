const { CHAT_SYSTEM_PROMPT, buildChatUserPrompt } = require('../config/chatPrompt');

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
    },
    required: ['findings', 'evidence', 'recommended_actions', 'insufficient_data'],
    additionalProperties: false,
  },
};

const FIELD_LIMITS = { findings: 3000, evidence: 3000, recommended_actions: 2000, insufficient_data: 1500 };

function validateAnswerPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Structured response missing or not an object.');
  }
  const allowed = Object.keys(FIELD_LIMITS);
  const unexpected = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unexpected.length) throw new Error(`Unexpected field(s): ${unexpected.join(', ')}.`);
  if (typeof input.findings !== 'string' || input.findings.trim().length === 0) {
    throw new Error('findings missing, empty, or not a string.');
  }
  for (const field of allowed) {
    const value = input[field];
    if (field === 'findings') continue;
    if (value !== null && typeof value !== 'string') throw new Error(`${field} must be a string or null.`);
    if (typeof value === 'string' && value.length > FIELD_LIMITS[field]) {
      throw new Error(`${field} exceeds ${FIELD_LIMITS[field]} characters.`);
    }
  }
  if (input.findings.length > FIELD_LIMITS.findings) throw new Error(`findings exceeds ${FIELD_LIMITS.findings} characters.`);
  return input;
}

async function askQuestion(context) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const userPrompt = buildChatUserPrompt(context);

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
      system: CHAT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
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

