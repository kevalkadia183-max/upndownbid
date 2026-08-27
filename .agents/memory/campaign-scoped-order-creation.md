---
name: Campaign-scoped order creation
description: How to gate creation of a new payment-provider order (e.g. PayPal order) on the campaign a payment belongs to, without trusting the client.
---

A pending checkout (owner claim, boost, push-down) must never be resumable into a brand-new provider order once its campaign has ended, even if the client's local state still thinks the campaign is live.

**Why:** the client only has a heuristic view of campaign status (a cached query, sessionStorage timestamps). A user who leaves a tab open across a weekly rollover, or a tampered client that fabricates campaign fields, must not be able to force a new order against a stale campaign — ranks and payouts are tied to a specific campaign window.

**How to apply:**
- Put the authoritative check in the single lib-level function that creates a new provider order (e.g. `createPayPalOrder`), not in the route handler and not duplicated across callers. That function already loads the payment row itself, so it re-derives the current campaign server-side and compares it to `payment.campaignId` — the value written to the DB at checkout time, never anything the client sends on this call.
- Only enforce the check before a new order is created. If the order was already bound to the provider (idempotent replay / already has a `providerCheckoutId`), skip the check and let the in-flight approval/capture complete — rejecting an in-flight order because the campaign rolled over mid-approval would break an otherwise-valid payment.
- It's safe to call a second `db.transaction(...)`-wrapped helper (e.g. the current-campaign lookup) from inside an already-open transaction here: they touch disjoint tables/rows, so there's no lock-ordering deadlock risk in this schema.
- Client-side, treat campaign-match + not-ended + a TTL (independent of campaign end, e.g. 30 min) as a UI heuristic only, for deciding whether to show a "resume" affordance — clear silently (no error text) when stale. The server check above is the real boundary.
