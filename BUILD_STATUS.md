# Orb Intelligence — BUILD STATUS

Last updated: 2026-08-13, this session. Statuses: **COMPLETE AND PROVEN** / **PARTIALLY IMPLEMENTED** / **BUILT BUT NOT YET PRODUCING INTELLIGENCE** / **EXTERNAL DATA PROVIDER REQUIRED** / **NOT BUILT**

Each item evaluated on three layers per the standing instruction: does Orb have the DATA, does it automatically produce INTELLIGENCE from that data, does the owner actually receive it (EXPERIENCE). A requirement is not complete unless all applicable layers are.

## Autonomous Account Brain / Investigation Loop

**PARTIALLY IMPLEMENTED.**
- DATA: real, for paid/social/local, Easley only at real richness; 57/64 locations have paid-only.
- INTELLIGENCE: `run_cross_source_detection` (DETECT) -> `open_investigation_for_signal` (INVESTIGATE, auto-wired) -> `recheck_investigation` (MONITOR OUTCOME, built and logic-tested this session) -> `promote_repeated_signals_to_memory` (LEARN). The full chain exists and is wired. Real limitation, stated plainly: the recheck logic has only been validated against the same data point it was created from (no new period has synced since) - it has not yet been proven against genuinely new incoming data. That's the next real test, not an assumption.
- EXPERIENCE: the client Brain landing shows the resulting briefing/findings; investigations themselves (question/evidence/conclusion) have no client-facing UI yet - the data is real, the owner cannot currently see it.

## Orb Activity -> Outcome -> Learning Loop

**BUILT BUT NOT YET PRODUCING INTELLIGENCE.**
- DATA: 1 real activity row exists (Easley), manually entered tonight, genuinely true. No automatic capture from any provider exists - 100% of activity capture today would be manual entry via the fast endpoint.
- INTELLIGENCE: orb_activity rows are surfaced as evidence inside investigations, but nothing yet measures a before/after performance delta specifically attributable to a logged activity. The action-outcome causal comparison described in the spec is not built.
- EXPERIENCE: shown in "What Orb Has Been Doing" on Explore.

## Persistent Business Memory

**PARTIALLY IMPLEMENTED.**
- DATA/INTELLIGENCE: promote_repeated_signals_to_memory genuinely requires 2+ real occurrences, confidence scales honestly (emerging->moderate->strong), tested to correctly produce 0 rows where no repetition exists (63 of 64 locations). One real row exists for Easley.
- Real gap: memory is never revised - nothing currently downgrades or retires a memory if subsequent evidence contradicts it. Not built.
- EXPERIENCE: shown in "What Orb Is Learning," natural-language translated (verified this session - raw enum values no longer leak into this text).

## Market Intelligence

**EXTERNAL DATA PROVIDER REQUIRED** (for automated/scaled version); **PARTIALLY IMPLEMENTED** for Easley specifically.
- DATA: 1 real market profile (Easley), sourced via manual web search, honestly labeled medium confidence, no lat/long. Zero automated collection exists - there is no code that would produce this for location #2 without a human repeating the same manual search.
- INTELLIGENCE: nothing yet reasons from market data into a signal or investigation.
- EXPERIENCE: shown as a static line in Explore.
- Real requirement to scale this: Google Places or equivalent geocoding/trade-area API.

## Competitive Monitoring

**PARTIALLY IMPLEMENTED**, real automation exists but is starved of data.
- DATA: 2 real, named, sourced competitors for Easley; 1 real observation each (baseline only); zero for every other location.
- INTELLIGENCE: detect_competitor_changes is real, generalized, tested to correctly return 0 (no second observation exists yet to compare against). The mechanism is proven; it has never yet detected a real change because no competitor has been observed twice.
- EXPERIENCE: competitor list shown in Explore; no "competitive pulse" summary reasoning is wired into the Brain landing's actual data yet (the landing text exists but currently just counts rows, doesn't yet reflect real detected changes since none exist).
- Real requirement to scale: a local-competitor-discovery provider (Google Places or equivalent) and, optionally, SpyFu for search/PPC - neither connected.

## Ask Orb / Complete Context Reasoning

**PARTIALLY IMPLEMENTED.**
- DATA fed to the model: paid, social, local, health, intelligence timeline, market profile, competitors, open questions - all real, verified wired in buildTenantChatContext.
- Missing from context, confirmed by checking the actual function: Orb Activity, investigations, and business_memory are not yet included in what Ask Orb receives. This means a client asking "what did Orb do?" or "what have you learned?" today would get an answer from the model's general reasoning, not from the real rows that exist for exactly those questions. This is a real, concrete gap, not a stylistic one.

## Brain Client Experience

**PARTIALLY IMPLEMENTED.**
- Two-layer model (Brain landing / Explore) is real and deployed.
- Misleading Data Coverage removed from client view (verified this session).
- Real gap: the "primary development / opportunity / risk / next" prioritization currently picks from whatever's available rather than truly ranking by evidence strength - it's ordering, not scoring.

## Explore Evidence Center

**PARTIALLY IMPLEMENTED.** Real cards for Social/Paid/Local/Market/Competitors/Learning/Activity/History exist and pull real data. Not yet organized as separate navigable domains (currently one page with card sections) - a real, named, unaddressed gap.

## Orb Admin

**PARTIALLY IMPLEMENTED.** Real portfolio table (64 real rows, real scores ranging 14-70, proven this session) with an explicit, tested platform-admin check. No provisioning UI, no credential management UI, no investigation/Brain-run status surfaced in Admin yet.

## Bulk Provisioning / Access Management

**BUILT BUT NOT YET PRODUCING INTELLIGENCE (i.e. not yet used).** provisionClientAccess.js is real and correct (uses the proper Supabase Admin API, generates real random passwords, never stores them). It has been run for zero locations beyond the pre-existing Easley account. Not wired into Orb Admin as a clickable action.

## Automation

**COMPLETE AND PROVEN**, with one honest caveat. runBrainForAllLocations.js ran for real against all 64 locations this session (0 failures, 26 distinct real scores produced, correctly-honest 0/1 memory and investigation counts reflecting genuine data scarcity, not a bug). Cron is being installed as of this update - confirming the scheduled trigger fires is the one remaining unverified piece of an otherwise fully real, tested pipeline.

## Sync / Data Ingestion

**PARTIALLY IMPLEMENTED.** Meta+Google paid: real, 57/64 locations. Facebook Page organic + GBP local: real, but only ever run for Easley - the sync script supports it for any client with the right connections, but has not been executed portfolio-wide. Instagram: broken, isolated, documented, non-blocking.

---

## Honest overall assessment

The deterministic chain (detect -> investigate -> recheck -> remember) is real and, this session, was proven to run correctly across the entire portfolio, not just Easley - that is genuine, tested progress on the core autonomous-loop requirement. The most consequential remaining gap is not a missing function; it's that most of the portfolio has only paid data, so the richer intelligence (cross-source detection, investigations, memory, competitive change detection) currently has nothing to work with outside Easley. The second most consequential gap is that Ask Orb doesn't yet see Orb Activity, investigations, or business memory - three real data sources sit unused by the one interface most likely to be asked about them directly.

---

## Added this update, per the two most recent product-correction documents

### Orb's Operating Cadence (weekly review / monthly overhaul model)
**NOT BUILT.** No schema exists for review cadence, review type distinction (weekly optimization vs. monthly strategy overhaul vs. creative review vs. search review, etc.), or "last review / next review" tracking. orb_activity's activity_type enum does not yet distinguish these. Real, concrete next step, not yet started.

### Client-Safe Language Audit
**PARTIALLY IMPLEMENTED.** One real, self-identified violation fixed this session: open_questions gained a client_visible flag after discovering none of the 5 existing questions were genuinely client-answerable business questions - all were internal/provider gaps mislabeled as client-facing. Not yet done: a full audit of every other client-facing text surface (investigation conclusions, business_memory observations, briefing generator edge cases) for similar internal-language leakage.

### Industry & Market Pulse
**NOT BUILT.** No schema, no provider adapter, no Brain integration. This is architecturally similar to Market Profile/Competitors (timestamped observations, source, confidence) but for category/industry-level trends rather than the specific business or its named competitors. Requires an external content/trends provider not yet identified or connected.

### Search & Keyword Intelligence
**NOT BUILT.** No schema for tracked keywords, search demand movement, or Orb's own keyword/SEO work. Requires SpyFu or an equivalent search-intelligence provider - correctly not connected yet, and this domain has not been started even at the schema level.

### Website / SEO Activity as a Distinct Orb Activity Domain
**NOT BUILT.** orb_activity's activity_type enum has no website/SEO/search-specific values yet (landing_page_update exists but is not the same as an ongoing SEO/keyword review cycle).

### Brain Visualization Polish (premium animated neural visualization)
**PARTIALLY IMPLEMENTED.** A real, lightweight SVG exists with genuinely state-driven nodes (paid/social/local/market/competitive/creative activate based on real data presence) and a subtle CSS pulse. Not yet built: distinct visual states for MONITORING/ANALYZING/INVESTIGATING/SIGNIFICANT CHANGE DETECTED tied to real Brain-run state, and the more elaborate "luminous neural network" treatment described in the latest spec - what exists is a first real pass, not the finished version.

### Explore Domain Navigation (Overview/Customers/Advertising/Social/Local/Search/Website/Creative/Market/Industry/Competitors/Activity/History as separate views)
**NOT BUILT.** Explore remains one scrollable page with card sections. True tabbed/routed domain navigation has not been implemented.

### Real Security Finding This Session (for the record)
Bulk provisioning surfaced a genuine cross-tenant membership bug (two real organizations sharing a location name, a partial-failure path granted incorrect cross-org membership before failing). Found, root-caused, fixed at the data level (revoked), fixed at the code level (alias resolved and checked for uniqueness before any user/membership work), and confirmed no other instance of the same pattern exists in the portfolio.

---

## Gap analysis against NORTH_STAR.md — ordered by dependency, then value

**Tier 1 — no external provider needed, real data already exists, just not surfaced/wired:**
1. **Orb Admin is missing most of the real intelligence data that now exists.** `investigations`, `creative_jobs`, `ai_usage_log` (cost/usage), `orb_activity`, `location_review_cadence` all have real rows and real RLS, but Orb Admin's portfolio page only shows health/coverage/connections. This is the single highest-value, zero-dependency gap: the data is real, the admin-visibility requirement is explicit (North Star item 16), and it requires no new schema, no new provider, no new AI calls - just read access wired into the existing admin page.
2. **Ask Orb doesn't yet reason over `creative_jobs`.** A client asking "what have you created for me" today gets nothing, even though real creative jobs may exist.

**Tier 2 — needs schema + Brain-wiring, no external provider required for the architecture itself (population is provider-limited, same pattern as Market/Competitors):**
3. Search & Demand Intelligence schema (tracked keywords, demand movement, Orb's own search/SEO activity as a distinct activity domain).
4. Industry Intelligence schema (category-level relevance-filtered observations).

**Tier 3 — genuinely provider-blocked for automated/scaled population:**
5. Automatic competitor discovery at scale (Google Places or equivalent) - architecture exists, works for one manually-populated location.
6. SpyFu or equivalent adapter for search/PPC competitive enrichment - `competitor_observations` schema is ready to receive it.
7. Real image-generation adapter for Create - `creative_jobs.image_url`/`image_provider` columns exist, unused; text generation via Anthropic is real and proven.

**Decision: proceeding with Tier 1, item 1 now** - highest value, zero dependency, directly serves an explicit North Star requirement ("client simplicity must not come at the expense of internal visibility").
