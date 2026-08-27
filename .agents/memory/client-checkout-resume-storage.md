---
name: Client-side checkout resume storage
description: How the upndownbid public checkout flow persists a retryable/pending payment attempt so a page refresh doesn't lose it or double-charge.
---

Public boost/push-down checkouts (artifacts/signalrank/src/components/signal-action-form.tsx) generate an idempotency key client-side. If the page refreshes mid-attempt, an in-memory-only key is lost, risking either a stuck retry loop or an accidental duplicate payment on next submit.

The fix: persist the opaque idempotency key plus the exact action details (type, amount, email, reason, reasonDescription) to `sessionStorage`, keyed by `${slug}:${type}` (artifacts/signalrank/src/lib/pending-checkout.ts). Two states are stored:
1. Retryable-but-unresolved (request failed ambiguously, no payment created yet) — details + key only.
2. Payment created but awaiting PayPal capture (`payment.status !== "succeeded"`) — details + key + `{ paymentId, listing }`. Resuming this state shows the PayPal buttons directly, without resubmitting the checkout request.

**Why:** The backend's replay check (artifacts/api-server/src/routes/signalrank.ts, `/public/listings/:slug/checkout`) already rejects a reused idempotency key whose request details don't match the original with a 409. Reusing a stale key after the user changed the amount/email/reason would just error, so the client must independently verify the stored details still match before reusing the key — otherwise it mints a fresh key and drops the stale linkage.

**How to apply:** Any new retryable/idempotent public checkout flow added to this app should follow the same pattern — store per (identifier, action-type), compare full request details before reuse, and clear the entry on confirmed success or confirmed (non-retryable) rejection. Session storage (not localStorage) is intentional: it should not survive across browser sessions/tabs since idempotency keys are meant to be short-lived retry aids, not permanent state.
