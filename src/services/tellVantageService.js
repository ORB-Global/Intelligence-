/**
 * Tell Vantage - classifies a free-form owner statement ("Saturday
 * was dead", "we just got 50 mattresses in") into structured type +
 * durability, using the same Anthropic tool-call pattern proven in
 * creativeService.js. Never stores every statement as permanent
 * truth - durability is classified, not assumed.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const TOOL_NAME = 'classify_statement';
const CLASSIFY_TOOL = {
  name: TOOL_NAME,
  description: 'Classify a business owner\'s free-form statement about their business.',
  input_schema: {
    type: 'object',
    properties: {
      classified_type: { type: 'string', enum: ['observation', 'goal', 'constraint', 'event', 'promotion', 'inventory_context', 'customer_signal', 'temporary_context'] },
      durability: { type: 'string', enum: ['permanent', 'seasonal', 'temporary', 'one_time'], description: 'permanent = a lasting fact about the business; seasonal = recurring but not constant; temporary = true for days/weeks; one_time = a single past event with no forward relevance' },
      ai_summary: { type: 'string', description: 'One concise sentence capturing what this means for the business, in plain language.' },
      is_goal: { type: 'boolean', description: 'True only if the owner is stating what they want to accomplish (a goal), not just reporting a fact.' },
    },
    required: ['classified_type', 'durability', 'ai_summary', 'is_goal'],
  },
};

const SYSTEM_PROMPT = `You classify short statements a small-business owner makes about their own business. Be conservative: most statements are temporary observations, not permanent facts. A statement is only "permanent" durability if it describes something structurally true about the business (e.g. "we only sell mattresses, no furniture"), not a single event or a current condition. Never invent details beyond what's stated.`;

async function classifyStatement(rawText) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Classify this statement: "${rawText}"` }],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${rawBody}`);

  const parsed = JSON.parse(rawBody);
  const toolUseBlock = (parsed.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUseBlock) throw new Error('No structured classification returned.');

  return toolUseBlock.input;
}

module.exports = { classifyStatement };
