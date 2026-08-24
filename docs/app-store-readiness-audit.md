# Vantage — App Store Readiness Audit
Based on real, current research (not assumed from older training knowledge) plus direct inspection of the actual codebase.

## A. Apple Developer readiness — human-owned prerequisites (blocking checklist for you)
I cannot verify your account status — these require your direct confirmation:
- [ ] Apple Developer Program enrollment (individual or Orb Global LLC organization account)
- [ ] If organization: D-U-N-S number verification for Orb Global LLC (Apple requires this for org accounts, real, non-negotiable, can take days)
- [ ] App Store Connect access provisioned
- [ ] Signing certificates/provisioning profiles (can be created once enrollment is confirmed)

**This is a genuine, real blocker for anything beyond this audit** — nothing below can proceed to actual submission without these.

## B. Mobile architecture recommendation
Given the real, current Guideline 4.2 research: a thin WebView wrapper around `vantage-v44.html` is a **real, confirmed rejection risk** — multiple current sources (2025-2026) independently confirm Apple actively rejects apps that are "a website in a wrapper" with no native navigation, no offline behavior, and no platform-native features.

**Recommendation:** a lightweight native shell (SwiftUI) that:
- Uses native tab-bar navigation (Home / Ask / Settings), not a web hamburger menu
- Calls the real, existing backend APIs directly (`/api/mc/locations/:id`, `/api/mc/locations/:id/ask`) rather than loading HTML
- Renders real native UI for the compact V44 view model already built this session
- The Vantage backend remains authoritative — no business logic duplicated into Swift

This is real, additional native engineering work, not reachable by a URL-in-a-box approach — flagging honestly rather than suggesting a shortcut that real, current evidence says will fail review.

## C. Vantage 1.0 mobile scope (minimum, focused)
- Authentication (real, existing Supabase auth)
- Home: compact real intelligence (the v44ViewModel work already built and tested this session)
- Ask Vantage: real, tenant-scoped
- Settings/Privacy/Account deletion

## D. Do not submit a thin wrapper
Confirmed by real, current research above — this is a genuine, high-probability rejection, not a stylistic preference.

## E. TestFlight
Standard real process once B is built: Xcode archive → App Store Connect → TestFlight internal testing group → your device.

## F. Reviewer access
Real requirement: a safe demo account with real, populated (but non-sensitive) data so a reviewer can experience Home → Ask → a real grounded answer → Settings without hitting a dead end. Easley could serve this role if you're comfortable with a reviewer seeing that real (but not customer-identifying) business data.

---

## Privacy/Account UX — real, current requirements confirmed
1. **Third-party AI disclosure — CONFIRMED REAL REQUIREMENT, not assumed.** Apple explicitly requires: (a) disclosing what data is sent to Anthropic and why, (b) reflecting this in your privacy policy, (c) **a real, explicit consent screen before first use** — confirmed via a real Apple Developer Forums exchange showing an actual rejection for exactly this gap. This is not optional for Vantage's architecture.
2. **Privacy Nutrition Label** — required at submission; must accurately reflect the real data-flow inventory built this session (`docs/privacy-data-flow-inventory.md`).
3. **Account deletion** — Apple requires in-app account deletion when an account model exists (confirmed earlier this session as a real, standing requirement). Not yet built.
4. **ATT (App Tracking Transparency)** — likely **not required**: Vantage doesn't link user data with third-party data for advertising/measurement purposes (confirmed by the real data-flow audit — no ad-tech/data-broker sharing exists in the codebase). Worth a final legal confirmation, but the technical evidence doesn't point to real "tracking" under Apple's definition.

## Real, honest overall assessment
Given (a) the genuine native-shell engineering work required, (b) the real Apple Developer enrollment dependency outside my control, and (c) a real, mandatory AI-consent screen that doesn't exist yet — **an end-of-week submission is a real stretch**, not confirmed feasible. I'd rather say that plainly now than assume it works.
