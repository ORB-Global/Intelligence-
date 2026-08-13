# Orb Intelligence — PRODUCT ARCHITECTURE

This document defines what Orb Intelligence *is*, as distinct from a marketing dashboard with AI attached. It is written against what's actually real in the codebase tonight — where something doesn't exist yet, it's marked `NOT BUILT`, not described as if it were finished.

---

## 1. What the Brain is

The Brain is not a page. It is a **per-location, persistently stored state** (`location_brain_state`, plus the tables that feed it: `signals`, `investigations`, `business_memory`, `recommendations`, `orb_activity`) that exists and updates whether or not anyone is logged in. Mission Control's Brain landing is a *window into* that state, not the state itself. This distinction is real today: `location_brain_state` is a real table, updated by a real scheduled function, independent of any page load.

## 2. What it does automatically, daily/weekly/monthly

**Daily (real, cron-scheduled, proven across all 64 locations):**
`syncOviondClients.js` (ingest) → `run_location_brain()`, which internally runs, in order: `compute_health_score` → `run_cross_source_detection` → `detect_single_source_anomalies` → `promote_repeated_signals_to_memory` → `decay_stale_memory` → `evaluate_pending_activity_outcomes` → writes one canonical `location_brain_state` row → `detect_competitor_changes`.

**Weekly / Monthly (schema real, human-triggered, not yet automatic):** `location_review_cadence` tracks last/next weekly review and monthly overhaul per location, updated when a staff member logs a `review_type`-tagged `orb_activity` entry. The *tracking* is automatic; the *review itself* is still human work, same as a real agency. This is honest, not a gap to hide — Orb doesn't do the strategic thinking of a monthly overhaul, it remembers that one happened and what came of it.

## 3. What happens when it detects something

A detector (`run_cross_source_detection`, `detect_single_source_anomalies`, `detect_competitor_changes`) writes a row to `signals` with `finding_type` (`observed_fact` / `inference` / `hypothesis`) and real evidence. If the signal is a genuine cross-source pattern, `open_investigation_for_signal()` fires automatically in the same transaction — detection and investigation-opening are not two separate manual steps.

## 4. How investigations work

`investigations` is a distinct entity from `signals` — it has a `question`, `evidence_collected` (append-only, grows as more evidence arrives), `possible_explanations`, `confidence`, `status` (`open`/`investigating`/`resolved`/`inconclusive`), and a `next_check_at`. `recheck_investigation()` re-examines it against current data on its own schedule and either resolves it with a real conclusion or marks it inconclusive — never silently expires. This closes the loop the earlier build sessions left open (`next_check_at` existed as a column for a while with no code that ever read it — found and fixed this session).

## 5. How external intelligence enters the Brain

**Real today:** Market Profile and Competitors are real tables, joined into both the deterministic briefing and the Ask Orb context — not separate dashboard tabs the Brain ignores.

**`NOT BUILT`:** Industry & Market Pulse (category-level trend awareness) and Search & Demand Intelligence (keyword/search-visibility awareness) have no schema yet. Per the architecture principle, these should be built the same way Market/Competitors were: real tables with provenance and confidence, wired directly into signal detection and the briefing generator — never a standalone "Industry" page that the Brain doesn't actually read from.

## 6. How Orb Activity affects reasoning

Two real mechanisms, not one: (a) `orb_activity` rows are pulled as evidence when an investigation opens — "did Orb change something recently" is a real question the investigation-opener asks. (b) `evaluate_pending_activity_outcomes()` independently compares before/after metrics around an activity's timestamp and writes a real `outcomes` row with careful "observed association" language — this is the WE DID THIS → THIS HAPPENED step, tested and proven (though only logically validated so far; no activity has yet aged the full 14 days against genuinely new incoming data).

## 7. How recommendations become actions/creative

**Real today:** `recommendations` → `tasks` (the human "action taken" record) → `outcomes`. This loop is real and tested.

**`NOT BUILT`:** The Create surface (SIGNAL → INVESTIGATION → OPPORTUNITY → CREATE → ORB ACTIVITY → MONITOR → OUTCOME → MEMORY) does not exist. No creative-generation provider is connected. Building this correctly means: a `creative_assets` table (tenant-scoped, storing the prompt, the source signal/opportunity/investigation it came from, status, and the generated output reference), a server-side provider adapter (so the actual image/copy generation service is swappable, matching the same "provider adapter, not hard-coded" pattern already used for Oviond), and a real UI entry point from an opportunity/recommendation ("Create from this"). None of this exists yet. It is real, scoped, buildable work — not started.

## 8. How outcomes become memory

`evaluate_pending_activity_outcomes` and `recheck_investigation` both write real outcome/conclusion records. `promote_repeated_signals_to_memory` only creates a `business_memory` row when the *same signal type* has genuinely recurred 2+ times — never from a single occurrence. `decay_stale_memory` is the reverse direction: a memory that hasn't been reconfirmed in 90+ days loses confidence rather than sitting permanently at whatever level it last reached. Both directions are real and tested, not just the growth direction.

## 9. What belongs in Brain vs. Explore vs. Create vs. Activity

- **Brain** (landing, minimal): the deterministic briefing, the top 3-5 prioritized findings, competitive/market *pulse* (a sentence, not a list), Ask Orb as a first-class action, "Show Me Why" evidence drill-down. Nothing here should be a raw table dump — confirmed this session (raw JSON evidence and raw signal descriptions were both found leaking into this layer and fixed).
- **Explore** (the dashboard, and that's fine here): channel-by-channel cards and charts, the full competitor list, full market profile detail, full activity log, full history. This is where "what" lives.
- **Create** (`NOT BUILT`): the action surface — turning a Brain-identified opportunity directly into generated creative work, tenant-scoped and tied back to the intelligence that prompted it.
- **Activity** (partially real): currently folded into Explore as a card; the spec now asks for it as a fourth primary surface in its own right, showing reviewed/optimized/launched/adjusted/watching in human terms. The data (`orb_activity`, `location_review_cadence`) is real; a dedicated top-level surface for it is not built yet.

## 10. What the client experiences in the first 10 seconds

Real today: greeting, a deterministic one-paragraph briefing computed from genuine period-over-period comparisons across whatever real sources exist for that location, the 3-5 highest-priority findings, a competitive pulse sentence, a market pulse sentence, and a prominent Ask Orb entry point. Confirmed this session to no longer contain: raw JSON, raw internal signal names, misleading internal-configuration numbers (Data Coverage), or empty-state language that makes the product look unfinished (Creative Intelligence's old "no data" card was removed, not filled with a fake state).

Not yet real: the animated Brain visualization is a first genuine pass (real SVG, real state-driven node activation based on which evidence domains have data) but not the fuller state-aware version (MONITORING/ANALYZING/INVESTIGATING visually distinct, tied to actual Brain-run timing) repeatedly specified. This is the most-named unfinished piece of the primary experience and the honest next visual priority once Create's backend exists to justify a bigger visual pass.

---

## Summary: the actual gap between "AI Brain" and "dashboard," honestly

The deterministic reasoning loop (observe → detect → investigate → remember → recheck → decay) is real, tested against more than one location every time, and now running on a schedule. That is the Brain, and it is not decorative. What's still dashboard-shaped is the *external intelligence surface area* (Industry, Search/Demand) and the *action surface* (Create) — both correctly identified as missing, both architecturally scoped above, neither started. The path from here is: build those following the exact pattern already proven for Market/Competitors (real schema, real provenance, wired into detection and the briefing — not a page the Brain doesn't read from), and only then invest in the fuller visual treatment, since a beautiful visualization of an incomplete Brain is the dashboard mistake in a different costume.

---

## Addendum: the self-evaluating decision loop (this session)

The prior version of this document described a Brain that detects, investigates, and remembers. It was missing the piece that makes those decisions *self-correcting*: judgment on whether Orb's own past recommendations were right.

**Real, tested this session:**
- `location_thesis` (table) + `synthesize_thesis()` (function): one persistent narrative belief per location, deterministically composed from real current signals/investigations/memory, never AI-generated fresh on page load. Preserves the previous thesis so "did my belief change" is a checkable fact (`changed_from_previous`), not an assumption. Tested on 2 locations - genuinely different real content each (Easley: 4 signals, 1 pattern, 1 open investigation; Hannibal: 1 signal, 0 patterns, no open investigation).
- `recommendation_verdicts` + `judge_recommendation_outcome()`: renders an explicit verdict (`validated` / `not_validated` / `inconclusive`) on whether a recommendation's linked outcome actually supports it, using the outcome's measured percent-change. Tested on the one real linked outcome that exists - correctly returned `inconclusive` because the measurement is honestly still pending, not fabricated as a false positive.
- `recommendation_track_record`: accumulates verdicts by recommendation category per location - the raw material for eventually saying "recommendations like this have historically worked/not worked for this business," though nothing yet reads this table to *change* future recommendation generation - that wiring is the next real step, not done tonight.

**Honest limitation, stated plainly:** the verdict-judging heuristic (percent-change threshold) is simple by necessity - there is exactly one real recommendation-outcome pair in the data, and it's an honest "not yet measurable" case. The `validated`/`not_validated` paths are implemented and logically tested but have never yet fired against real data. That's not a gap to hide; it's what happens when the discipline is "prove it against real data" and the real data hasn't accumulated yet.
