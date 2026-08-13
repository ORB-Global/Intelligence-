/**
 * The ONE canonical client-facing intelligence presentation layer.
 * Every consumer that shows intelligence to a client (Brain briefing,
 * Ask Orb, Orb Activity summary) should call through here rather than
 * touching raw signal/investigation/activity rows directly.
 *
 * Internal detector output (signals, investigations) can stay
 * technical in its raw form if needed later - this file is where
 * "internal intelligence" becomes "client language," in one place,
 * so a future language fix only has to happen here once.
 */

const MOMENTUM_LABELS = {
  significant_positive: 'Significant positive change',
  positive: 'Positive momentum',
  stable: 'Stable',
  mixed: 'Mixed',
  needs_attention: 'Needs attention',
};

/**
 * Synthesizes a single business-level momentum conclusion from
 * whatever real signals/recommendations exist - never a raw metric
 * dump, never a numeric health score presented as the headline.
 */
function synthesizeBusinessPerformance({ crossSourceSignals, singleSourceSignals, briefingText }) {
  const positiveCrossSource = (crossSourceSignals || []).some((s) =>
    /more people|increased|jumped|stronger/i.test(s.description || ''));
  const anyNegativeSingleSource = (singleSourceSignals || []).some((s) =>
    /decreased|dropped|fewer|declined/i.test(s.description || ''));
  const anyPositiveSingleSource = (singleSourceSignals || []).some((s) =>
    /increased|jumped|more|improved/i.test(s.description || ''));

  let momentumKey = 'stable';
  if (positiveCrossSource) momentumKey = 'significant_positive';
  else if (anyPositiveSingleSource && anyNegativeSingleSource) momentumKey = 'mixed';
  else if (anyPositiveSingleSource) momentumKey = 'positive';
  else if (anyNegativeSingleSource) momentumKey = 'needs_attention';

  return {
    momentum: MOMENTUM_LABELS[momentumKey],
    momentumKey,
    summary: briefingText || "Orb doesn't have enough history yet to give you a full picture.",
  };
}

const ACTIVITY_TYPE_VERBS = {
  review: 'Reviewed', optimization: 'Optimized', launch: 'Launched', test: 'Tested',
  creative_change: 'Updated creative', budget_change: 'Adjusted budget', targeting_change: 'Adjusted targeting',
  landing_page_update: 'Updated the website', connection_repair: 'Fixed a data connection', client_conversation: 'Connected with you',
  other: 'Made an update',
};

/**
 * Turns raw orb_activity rows into a real weekly summary, deduplicated
 * by real content (not literally "Analyzed" twice with no
 * differentiation) - groups by verb, keeps distinct descriptions.
 */
function presentOrbActivitySummary(activityRows) {
  if (!activityRows || !activityRows.length) {
    return { headline: 'No recorded activity yet this period.', items: [] };
  }
  const seen = new Set();
  const items = [];
  for (const a of activityRows) {
    const key = `${a.activity_type}:${a.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ verb: ACTIVITY_TYPE_VERBS[a.activity_type] || 'Worked on the account', description: a.description, occurredAt: a.occurred_at });
  }
  const headline = items.length === 1
    ? `This period, Orb ${items[0].verb.toLowerCase()}.`
    : `This period, Orb made ${items.length} real updates to this account.`;
  return { headline, items };
}

module.exports = { synthesizeBusinessPerformance, presentOrbActivitySummary, MOMENTUM_LABELS };
