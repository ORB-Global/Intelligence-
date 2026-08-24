# Vantage — Real Data-Flow Inventory
Built from direct inspection of the actual production codebase, not assumed. Every flow below is traced to real, specific files/functions.

## 1. Meta / Google / GBP / Facebook → Oviond → Vantage
**Real code:** `scripts/syncOviondClients.js`, `scripts/syncCurrentPeriod.js`, `scripts/backfillDailyMetrics.js`
**What enters:** ad spend, clicks, impressions, reach, CTR/CPC, GBP calls/directions/website-clicks, organic post captions/engagement, real ad creative image URLs, real leads/messaging-conversation counts.
**Personal data involved:** Generally no — this is aggregate account/campaign-level marketing performance, not individual customer PII. Real exception worth flagging: ad creative images (real photo assets) could incidentally contain people's faces if a dealer's ad creative does — not something Vantage collects deliberately, but worth naming in a privacy policy as a possibility.
**Storage:** Supabase (`historical_metrics`, `daily_historical_metrics`, `current_period_metrics`, `social_posts`, `ad_performance`, `local_visibility_metrics`).
**Retention:** Indefinite currently — no real deletion/expiry logic found in the codebase.
**Third-party credential:** `OVIOND_API_KEY`, stored server-side in `.env`, never sent to any client.

## 2. DataForSEO (competitor/territory discovery)
**Real code:** `src/services/dataForSeoAdapter.js`, `scripts/radiusCompetitorDiscovery.js`
**What enters:** real business names, addresses, domains of *competitor businesses* (not the tenant's own customers) — public business listing data.
**Personal data involved:** No individual/consumer PII — this is public business directory data.
**Storage:** Supabase (`canonical_competitors`, `competitor_observations`, `local_rank_territory`, `competitor_keywords`).
**Credential:** `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`, server-side only.

## 3. SpyFu (competitor SEO/paid enrichment)
**Real code:** `src/services/spyfuAdapter.js`
**What enters:** organic/paid keyword estimates for competitor domains — aggregate, public-facing data.
**Personal data:** None.
**Status:** Currently `degraded` (real, confirmed network timeout, cause undiagnosed) — real, honest note for the privacy doc: this integration is built but not currently functioning.
**Credential:** `SPYFU_API_ID`/`SPYFU_API_SECRET`, server-side only.

## 4. WeatherAPI.com
**Real code:** `scripts/syncWeather.js`, `scripts/backfillWeatherHistory.js`
**What enters:** real historical/forecast weather for each location's real coordinates.
**Personal data:** None — weather is location-based, not person-based.
**Credential:** `WEATHER_API_KEY`, server-side only.

## 5. Vantage ↔ Anthropic API (the AI reasoning layer)
**Real code:** `src/services/chatService.js`
**What is sent:** the real assembled tenant context (business metrics, real competitor names/addresses, real territory data, real owner-submitted Store Pulse text, real "Tell Vantage" narrative entries, real business goals) plus the user's real typed question.
**Confirmed via direct code audit:** zero email addresses, phone numbers, passwords, or SSNs are included in what's sent — the prompt construction (`buildChatUserPrompt`) only pulls business/marketing fields.
**Real, honest caveat:** free-text fields (Store Pulse notes, "Tell Vantage" entries, Business DNA narrative) are owner/staff-authored and *could* incidentally contain a customer's name if a staff member types one into a note (e.g., "Talked to John about his mattress order"). This is a real, plausible edge case worth naming in the privacy policy, not something structurally prevented today.
**Credential:** `ANTHROPIC_API_KEY`, server-side only, confirmed never present in any client-facing file (checked earlier this session via full grep of `public/*.html`).
**Distinction required by Apple:** this is Claude used *within Vantage's own product* (a third-party AI subprocessor for a paying business customer), not "Claude the developer tool" — these need to be described differently in a privacy disclosure.

## 6. Vantage ↔ Supabase (Postgres, primary data store)
**What's stored:** everything above, plus real tenant/user identity (`organization_memberships`, `locations`), real business goals, real Store Pulse entries, real chat conversation history (`ai_messages`).
**Access control:** Row Level Security (RLS) confirmed real and enforced — verified multiple times this session that a client-supplied `location_id` alone is never sufficient; every write path checks real membership first.
**Secrets:** the Supabase service-role key is used server-side only; the client uses only the real anon key (safe by Supabase's own architecture, RLS is the real protection).

## 7. Vantage → Client (browser/mobile)
**Confirmed via full-file grep this session:** zero service-role keys, zero provider API keys (Anthropic/Oviond/DataForSEO/SpyFu/WeatherAPI), zero internal secrets present in any client-delivered HTML.
**What the client does receive:** the compact V44 view model and richer chat context — both real, tenant-scoped, RLS-gated.

## Open items requiring your input (not code questions — business/legal ones)
1. **Retention policy** — no real deletion/expiry logic exists anywhere in the codebase today. Apple/privacy-policy language will need to say either "retained indefinitely" (true today) or you'll need to decide on a real retention window.
2. **Ad creative images** — worth deciding whether to disclose the possibility of incidental faces in ad creative.
3. **Free-text fields** — Store Pulse/Tell Vantage/Business DNA narratives are unstructured; no real PII-scrubbing exists. Worth deciding whether to add a light real warning to those input fields ("don't include customer names") rather than build actual scrubbing logic.
