---
name: Cross-component expand trigger
description: How distant nav links open a self-contained, locally-stateful form component (e.g. the collapsible campaign claim module) without lifting its state.
---

`CampaignBidModule` (artifacts/signalrank/src/components/campaign-bid-module.tsx) owns a lot of local state/refs (pending-claim resume, checkout, success screen) and defaults to a collapsed compact CTA. Header nav, mobile nav, the mobile menu sheet, and the `/add-product` redirect route all need to force it open, but they are not ancestors of it in the component tree and it must stay self-contained.

The resolution: a tiny shared helper (`artifacts/signalrank/src/lib/claim-flow.ts`, `openClaimFlow()`) dispatches a custom `window` event (`upndownbid:open-campaign-claim`) and scrolls `#campaign-bid` into view; the module listens for that event (plus checks `location.pathname`/`hash` on mount) to set its own `expanded` state. Callers just call `openClaimFlow()` on click — no prop drilling or lifted state needed.

**Why:** lifting the module's state up would have meant threading it through every route/layout ancestor for a single collapse flag, disproportionate to the payoff, and risked disturbing the module's already-intricate resume/checkout logic.

**How to apply:** for any future "open this deeply-nested, stateful widget from elsewhere on the page" need in this app, reuse `openClaimFlow`'s pattern (or add a similarly-named event) rather than re-plumbing props.
