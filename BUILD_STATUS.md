# Orb Intelligence — BUILD STATUS

Last updated: 2026-08-13, this session.

## What is REAL and TESTED

**Data ingestion (proven, not assumed):**
- Meta Ads, Google Ads: real historical data, 6 months, 57 of 64 locations
- Facebook Page organic: real, live-tested (field-name bug found and fixed via real data inspection — `page_follows` was cumulative, not daily; corrected to `page_daily_follows`)
- Google Business Profile local visibility: real, live-tested
- Instagram: **broken.** Three real debugging attempts (metric simplification, dimension isolation, monthly granularity) all failed with the same vague Oviond 400. Isolated, does not block anything else.

**Intelligence engine (deterministic, tested on 2+ locations, not Easley-hardcoded):**
- `run_cross_source_detection()` — finds real cross-source patterns (paid+social+local moving together). Tested on Easley (found a real pattern) and Hannibal (correctly found nothing — no social/local data exists there). One real NULL-array-length bug caught via the second-location test and fixed.
- `run_location_brain()` — canonical per-location orchestrator (health score + cross-source detection + memory promotion + open-item tally), writes one canonical `location_brain_state` row.
- `promote_repeated_signals_to_memory()` — requires 2+ real occurrences before calling something a "pattern." Currently has exactly 1 real memory row (Easley), honestly empty for every other location.
- `open_investigation_for_signal()` — opens a structured investigation (question/evidence/possible explanations/confidence/status) automatically when a cross-source signal fires. Gathers real available evidence (Orb Activity, business memory, competitor changes), honestly omits sources with nothing to contribute.
- `detect_competitor_changes()` — compares a competitor's latest observation to its prior one. Correctly returns 0 until a second observation exists for a competitor (only initial-discovery baselines exist right now).

**Market/Competitive intelligence:**
- Easley has a real Market Profile (address, ZIP, service area) — sourced via web search, honestly labeled `medium confidence`, **not geocoded** (no lat/long — that needs Google Places).
- 2 real, named, cross-confirmed competitors for Easley (Mattress Firm Easley Town Center, Ashley - Easley) with real addresses.
- No other location has any market/competitor data yet — this work has only been done for the proof-tenant.

**Auth/access:**
- Client login alias system (account name → internal email, server-side resolution) — live-tested, works.
- `provisionClientAccess.js` — real script, uses Supabase Auth Admin API correctly, generates cryptographically random passwords, never stores them. Not yet run for any location beyond the pre-existing Easley account.
- Orb Admin portfolio page — real, Supabase-Auth-gated via an explicit `platform_roles` check (not row-count inference, which was a real bug caught before shipping).

**Client UI:**
- Two-layer model: minimal Brain landing (briefing + 3 prioritized concepts + competitive/market pulse + Ask Orb / Show Me Why / Explore actions) vs. Explore My Business (the detailed cards/charts/timeline, hidden until requested).
- Misleading "Data Coverage: 0%" removed from client view (it measured confirmed-managed-service status, not actual data connectivity).
- `business_memory` and other client-facing text now translates internal enum values into plain language.

## What is BUILT BUT NOT YET AUTOMATED

Every function above (`run_location_brain`, `detect_competitor_changes`, etc.) has to be invoked manually right now. There is no cron/scheduler. This is the single largest gap between "the engine works" and "the product runs itself."

## What is SCHEMA-READY, GENUINELY EMPTY

- `investigations` — 1 real row (Easley), correct and tested, but only one location has ever triggered it
- `business_memory` — 1 real row, honestly empty everywhere else (no repeated pattern exists yet for any other location)
- `market_profiles` / `competitors` — populated for Easley only

## EXTERNAL PROVIDERS STILL REQUIRED

- **Google Places (or equivalent):** real geocoding, lat/long, trade-area math, automatic competitor discovery. Currently substituting real web search for one-off manual lookups — not a scalable substitute.
- **SpyFu:** SEO/PPC competitor enrichment. Not connected. Architecture (the `competitor_observations` fields) is ready to receive it.
- **Instagram (Oviond):** broken, isolated, needs an Oviond-side investigation I can't do myself.

## NOT YET BUILT

- Scheduled/cron execution of any Brain function
- Bulk provisioning across the other 63 locations
- Creative Intelligence (no real ad-creative-level data has been inspected yet)
- Full "Explore My Business" domain navigation (currently one scrollable page with section cards, not true separate tabbed views)
- SpyFu adapter code
- Investigation display in the client UI (the data exists and is real; no UI renders it yet)

## Honest self-assessment

The deterministic engine (detection, scoring, investigation-opening, memory promotion) is real, generalized, and has been tested against more than one location every time a "generalized" claim was made — that discipline held throughout. The gap between this and a finished product is almost entirely: (1) automation/scheduling, (2) doing the Easley-specific data-population work (market/competitor) for the other 63 locations, and (3) external provider credentials I don't have. None of those are shortcuts I can code around honestly.
