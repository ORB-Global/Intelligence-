/**
 * Pure computation, no I/O. Percent-change math happens here in code,
 * not left to the AI to compute from raw numbers — reduces the risk
 * of an AI arithmetic error being presented as a fact.
 */

function pctChange(current, previous) {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  const prevNum = Number(previous);
  if (prevNum === 0) return null;
  return ((Number(current) - prevNum) / prevNum) * 100;
}

/**
 * Builds a per-channel comparison between a current and previous
 * period's channel_snapshots rows. Channels with no current-period
 * row are reported as such, not silently dropped — the AI needs to
 * know a channel has no data, not just see it missing.
 */
function buildChannelComparison(currentRows, previousRows) {
  const channels = Array.from(new Set([...currentRows, ...previousRows].map((r) => r.channel)));

  return channels.map((channel) => {
    const cur = currentRows.find((r) => r.channel === channel) || null;
    const prev = previousRows.find((r) => r.channel === channel) || null;

    if (!cur) {
      return { channel, status: 'no_current_period_data', current: null, previous: prev, comparison: null };
    }

    if (!prev) {
      return { channel, status: 'no_previous_period_data', current: cur, previous: null, comparison: null };
    }

    return {
      channel,
      status: 'has_comparison',
      current: cur,
      previous: prev,
      comparison: {
        spend_pct_change: pctChange(cur.ad_spend, prev.ad_spend),
        impressions_pct_change: pctChange(cur.impressions, prev.impressions),
        reach_pct_change: pctChange(cur.reach, prev.reach),
        clicks_pct_change: pctChange(cur.clicks, prev.clicks),
        ctr_pct_change: pctChange(cur.ctr, prev.ctr),
        cpc_pct_change: pctChange(cur.cpc, prev.cpc),
      },
    };
  });
}

module.exports = { pctChange, buildChannelComparison };
