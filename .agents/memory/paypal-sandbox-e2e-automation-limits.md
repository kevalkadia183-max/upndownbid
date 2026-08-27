---
name: PayPal sandbox e2e automation limits
description: A Playwright testing subagent can drive the app's side of a real PayPal sandbox checkout up to the hosted login screen, but cannot complete it without buyer credentials it has no way to fetch.
---

In this environment the testing subagent (Playwright-based) has no secrets-retrieval helper (`requestSecrets` is not defined in its sandbox), and pasting sandbox buyer credentials directly into its task prompt is not an acceptable way to hand them over. So a fully autonomous e2e test can reliably verify:
- the app's own checkout UI (dialog, pricing/availability summary, policy step, payment-confirmation step),
- that clicking "Pay"/checkout genuinely calls the real backend checkout endpoint and creates a real pending payment,
- that the PayPal JS SDK loads and renders its button, and that clicking it opens a real `sandbox.paypal.com` login popup —

but it cannot log into that popup and finish the buyer-approval + capture steps, since that requires real PayPal sandbox buyer credentials it cannot obtain on its own.

**Why:** completing a PayPal Smart Buttons checkout requires actual buyer authentication on PayPal's own hosted page; there is no server-to-server bypass for sandbox approval, and credential secrets must never be pasted into a subagent prompt.

**How to apply:** for any paid flow, treat "app-side checkout UI renders correctly and a real pending payment/order is created, up through PayPal's own login screen appearing" as the ceiling of autonomous e2e coverage. Rely on the automated backend test suite (which uses the app's non-PayPal "test" payment-provider branch to synchronously complete payments) to verify the actual activation/invoice/analytics logic beyond that point, rather than forcing a full live PayPal completion through e2e.

A related, previously-solved gotcha: purchase endpoints that reject a second attempt while a prior pending reservation is still within its TTL window (e.g. "this listing already has a sponsorship pending or active") are correct/intentional, not a bug — if an earlier e2e attempt left a real pending record behind, either wait out the TTL or explicitly cancel/clear that specific fixture via a DB step before retrying the purchase flow.
