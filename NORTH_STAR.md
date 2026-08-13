# Orb Intelligence — NORTH STAR

This is the permanent, long-term product vision. Saved verbatim in intent (condensed here for repo use - the full document lives in the conversation history that produced it) as the standing reference every architectural decision is checked against.

## Core loop
OBSERVE -> DETECT -> INVESTIGATE -> UNDERSTAND -> EXPLAIN -> RECOMMEND -> ACT/CREATE -> MONITOR -> MEASURE -> LEARN -> REMEMBER -> back to OBSERVE.

## The Account Brain must eventually know
Business identity, historical performance/normal ranges, customer attention, advertising, social/community, local visibility, website, search & demand, market, industry, competitors, Orb Activity, creative, business memory.

## Four client environments
BRAIN (primary, alive, selective - not a KPI wall) / EXPLORE (the dashboard, evidence layer) / CREATE (intelligence -> action) / ACTIVITY (what Orb has actually done).

## Non-negotiables
- Trust states never blur: OBSERVED / INFERRED / HYPOTHESIS / RECOMMENDED / ACTED / MEASURED / LEARNED.
- Internal operational deficiencies (API failures, missing config, provider issues) stay in Orb Admin - never surfaced to clients as uncertainty.
- Memory is evidence-based and can strengthen, weaken, revise, or retire - never promoted from a single occurrence.
- Industry-neutral core - furniture-specific logic is configuration, not architecture.
- Cost-controlled - deterministic code does routine comparisons; AI is used for interpretation, not for every calculation.
- A capability is complete when it participates meaningfully in the loop - not when its schema/table/card exists.

## Stop-and-ask conditions (the only ones)
A credential/provider/account action only the user can perform; an irreversible/high-risk production decision; two genuinely mutually-exclusive product choices unresolvable from this document; a real production failure. Otherwise: decide, document, test, preserve production, continue.

## Usability addendum (added this session)

- Client-facing Brain language must be plain English, understandable without marketing knowledge. Technical terms ("cross-source signal", "sustained trend", "confidence weighting", "provider coverage") stay behind Show Me Why / Explore, never on the primary Brain surface.
- The Brain synthesizes into plain concepts: customer attention increasing/decreasing, audience growing, messages getting more/less expensive, local visibility strengthening/weakening, paid efficiency improving/declining, competitive pressure changing, creative may need refreshing.
- Orb should read as already ahead of the account ("Orb reviewed this during the weekly review", "Orb made an adjustment and is monitoring") - only when backed by real Orb Activity, never invented.
- Create must support both intelligence-driven ("Create from this opportunity") and simple everyday requests ("make me a Facebook post about X"), auto-carrying business identity/context either way.
- The 30-second test: a business owner with no marketing background should understand momentum, customer attention, ad performance direction, audience growth, local discovery, what Orb has done, and what's next - then be able to say "make me a post for that."

## THE CENTRAL DIFFERENTIATING CAPABILITY (added this session, supersedes prior framing as "one of many features")

Orb Intelligence is not a system that is intelligent about the business. It is a system that is intelligent about its own decisions regarding the business.

The loop that makes this different from every prior version of this build:

UNDERSTAND -> FORM A THESIS -> DETECT -> INVESTIGATE -> DECIDE -> ACT/CREATE -> WATCH -> JUDGE WHETHER THE DECISION WAS RIGHT -> UPDATE THE THESIS/MEMORY -> DECIDE DIFFERENTLY NEXT TIME.

The system must be able to say, eventually, for real: "I thought this. I recommended this. We did this. This happened. I learned this. Therefore I am changing what I recommend next." That sentence - not any individual feature - is the product.

Two structural requirements this implies, real and built this session:
1. A persistent THESIS - one coherent current belief, not a signals table - that visibly changes (or doesn't) from one Brain run to the next.
2. A VERDICT mechanism - not just "did an outcome get measured" but "was the recommendation that caused this outcome actually right," accumulating into a real track record that could inform future recommendation confidence.

I do not care whether every individual ingredient exists elsewhere. What matters is whether the complete closed loop is real, persistent, evidence-backed, and makes the system meaningfully smarter about one specific business over time - not whether any single piece is unprecedented.
