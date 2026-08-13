/**
 * Creative generation - the first real provider adapter for the
 * creative_jobs table. Text-based (headline/body copy/CTA/audience/
 * rationale) via the same Anthropic call pattern already proven in
 * chatService.js. image_url/image_provider columns exist on the table
 * for a future image-generation adapter - this file never touches
 * them, so adding one later doesn't require touching this code path.
 *
 * The whole point of an adapter: this function's signature (job in,
 * job updated) stays the same no matter which provider generates the
 * content. Swapping or adding providers means adding a new function
 * here and branching on job.provider - never rearchitecting the job
 * model itself.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const TOOL_NAME = 'submit_creative';
const CREATIVE_TOOL = {
  name: TOOL_NAME,
  description: 'Submit a structured creative concept grounded in the real business intelligence provided.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string' },
      body_copy: { type: 'string' },
      format_suggestion: { type: 'string' },
      cta: { type: 'string' },
      target_audience: { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['headline', 'body_copy', 'format_suggestion', 'cta', 'target_audience', 'rationale'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are Orb Intelligence's creative concept generator. You write ad copy, campaign concepts, and social content grounded strictly in the real business intelligence you're given - never generic marketing copy that could apply to any business.

CRITICAL RULES:
- Ground every creative decision in the specific evidence provided (the signal/recommendation/investigation that prompted this request, real performance data, real business context). Reference the actual reason this concept was requested in your rationale.
- Never invent facts about the business, its products, pricing, or promotions that weren't given to you.
- rationale must explain WHY this concept fits the specific opportunity/intelligence provided, not just describe the copy.
- Keep copy concrete and specific to the business, not generic ("shop now and save" is not acceptable if you have real evidence to work from).

You must call submit_creative with: headline, body_copy, format_suggestion (e.g. "Facebook single-image ad", "Instagram Reel", "Google Search ad"), cta, target_audience, and rationale.`;

async function generateCreative(job, context) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');

  const userPrompt = `BUSINESS: ${context.client?.name || 'Unknown'}

REQUEST TYPE: ${job.request_type}
PROMPT/INSTRUCTION: ${job.prompt || '(no additional instruction given - generate from the source intelligence below)'}

SOURCE INTELLIGENCE (the reason this creative was requested)
${JSON.stringify(job.context_snapshot || {}, null, 2)}

RECENT PERFORMANCE CONTEXT
${JSON.stringify(context.channelComparisons || [], null, 2)}

MARKET CONTEXT
${context.marketProfile ? JSON.stringify(context.marketProfile, null, 2) : '(not resolved)'}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [CREATIVE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    }),
  });

  const rawBody = await res.text();
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${rawBody}`);

  const parsed = JSON.parse(rawBody);
  const toolUseBlock = (parsed.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUseBlock) throw new Error('No structured creative response returned.');

  return toolUseBlock.input;
}

module.exports = { generateCreative };
