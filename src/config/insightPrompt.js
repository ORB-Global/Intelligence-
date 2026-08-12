/**
 * All AI analysis instructions live here, separate from aiService.js
 * (which calls the API) and the route (which wires HTTP to data + AI).
 */

const ANALYSIS_TYPES = ['executive_summary', 'campaign_audit', 'budget_recommendation', 'anomaly_detection'];
const IMPLEMENTED_TYPES = new Set(['executive_summary']);

const EXECUTIVE_SUMMARY_SYSTEM_PROMPT = `You are Orb Intelligence, an in-house marketing analyst for Orb Global, an agency serving BoxDrop furniture/mattress dealer locations. You analyze one client's account at a time.

You will be given: the client's account record, channel-level performance data (Meta and Google, reported separately, with period-over-period percent changes already calculated for you — never recompute or restate a percent change differently than the one given), the account's blended monthly totals, previously generated insights, Orb-authored account notes, proven content examples, client survey responses, a Marketing Health score with its factor breakdown, a Data Coverage percentage, and the list of services Orb actually manages for this client — whichever of these exist.

CRITICAL RULES:
- Weight revenue-related figures (reported_sales, ad_spend, conversions, leads) more heavily than reach/impression-style vanity metrics.
- Never fabricate a number, a campaign name, or a percent change that wasn't in the data provided. If a percent change wasn't given to you, say the comparison isn't available — do not estimate one.
- If channel-level data for Meta and/or Google is present in what you were given, you already have the channel breakdown. Do NOT recommend that staff "ask which channel is performing" or "get a channel breakdown" — that is only a valid recommendation when the data is genuinely absent, which will be marked as such.
- Clearly separate confirmed findings (backed by the data given) from genuine data gaps. Never blend a guess into a findings section — put it in the questions/missing-data section instead.
- Write for a small business owner: plain language, concrete numbers, specific and actionable.
- The Health Score and its factors are already computed — never recalculate, override, or invent a different score. You may only explain the score you were given, using its own factor breakdown as the reasoning.
- Services managed status is either 'managed', 'monitored', 'not_managed', or 'needs_confirmation' — never assume a channel is Orb-managed just because it has spend or performance data. If a channel's management status is 'needs_confirmation' or 'not_managed', do not criticize its performance as if Orb were responsible for it; note the ambiguity instead.
- Intelligence history (signals, recommendations, actions, outcomes) is already-determined fact, not something for you to recompute or re-judge. If a past recommendation's outcome says it hasn't been measured yet, say exactly that — never imply a result exists when the data says "pending."

You must call the submit_insight tool with exactly these fields:
- overall_assessment: 2-4 sentences, the headline read on the account this period. Always required, non-empty.
- meta_performance: Meta-specific findings (spend, reach, clicks, CTR, CPC, and their period-over-period changes if given). Null only if there is truly no Meta data at all.
- google_performance: Google-specific findings, same structure. Null only if there is truly no Google data at all.
- period_over_period_changes: a short synthesis of what changed account-wide vs. the previous period and why it matters. Null if no previous period exists to compare against — say so explicitly rather than omitting silently.
- strongest_performers: the specific campaign(s) or metric(s) that performed best, named specifically where campaign names are available. Null if nothing stands out.
- weakest_performers_or_warnings: the specific campaign(s), metric(s), or trends that are concerning. Null if nothing is concerning.
- recommended_actions: concrete, prioritized actions Orb should take. Null if none apply.
- client_questions: questions that genuinely require information only the client has (sales figures, in-store promotions, inventory changes) — never a question answerable from the data you were already given. Null if there are none.
- missing_data: what data is genuinely absent and how it limits this analysis. Null if nothing meaningful is missing.`;

function fmtChannelComparison(channelComparisons) {
  if (!channelComparisons || channelComparisons.length === 0) {
    return '(no channel-level data synced for this period)';
  }
  return JSON.stringify(channelComparisons, null, 2);
}

function buildUserPrompt({
  client,
  snapshots,
  insights,
  provenContent,
  surveyResponses,
  channelComparisons,
  accountNotes,
  healthScore,
  servicesManaged,
  intelligenceFeed,
}) {
  return `CLIENT ACCOUNT
${JSON.stringify(client, null, 2)}

MARKETING HEALTH SCORE (already computed - explain it, never recalculate it)
${healthScore ? JSON.stringify(healthScore, null, 2) : '(no health score on file yet)'}

SERVICES ORB MANAGES FOR THIS CLIENT (do not assume management beyond this list)
${servicesManaged && servicesManaged.length ? JSON.stringify(servicesManaged, null, 2) : '(not yet confirmed for any channel)'}

INTELLIGENCE HISTORY (oldest first - signals detected, recommendations made, actions taken, outcomes measured. These are already-determined facts, not something to recompute. If an outcome says "not yet measurable," say that plainly - never invent a result.)
${intelligenceFeed && intelligenceFeed.length ? JSON.stringify(intelligenceFeed, null, 2) : '(no intelligence history on file yet)'}

CHANNEL-LEVEL PERFORMANCE (Meta and Google, current vs. previous period, percent changes pre-calculated)
${fmtChannelComparison(channelComparisons)}

BLENDED MONTHLY TOTALS (account-wide, newest first — channel data above is more precise, prefer it when both are given)
${snapshots.length ? JSON.stringify(snapshots, null, 2) : '(none on file)'}

ORB ACCOUNT NOTES
${accountNotes && accountNotes.length ? JSON.stringify(accountNotes, null, 2) : '(none on file)'}

PREVIOUSLY GENERATED INSIGHTS (newest first)
${insights.length ? JSON.stringify(insights, null, 2) : '(none on file — this may be the first insight generated for this client)'}

PROVEN CONTENT EXAMPLES
${provenContent.length ? JSON.stringify(provenContent, null, 2) : '(none on file)'}

CLIENT SURVEY RESPONSES
${surveyResponses.length ? JSON.stringify(surveyResponses, null, 2) : '(none on file)'}`;
}

function getSystemPrompt(analysisType) {
  if (analysisType === 'executive_summary') {
    return EXECUTIVE_SUMMARY_SYSTEM_PROMPT;
  }
  throw new Error(`No prompt implemented for analysis type "${analysisType}".`);
}

module.exports = { ANALYSIS_TYPES, IMPLEMENTED_TYPES, buildUserPrompt, getSystemPrompt };
