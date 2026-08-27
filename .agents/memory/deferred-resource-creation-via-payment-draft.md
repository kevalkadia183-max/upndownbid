---
name: Deferred resource creation via payment metadata draft
description: Pattern for never persisting a resource row (e.g. a new listing) until its payment verifiably succeeds, with a race-safe single point of creation.
---

## The pattern

When a public flow both creates a new resource (claiming a unique field like a slug or website) *and* requires payment, do not insert the resource row eagerly at checkout time. Instead:

1. At checkout time, build a fully-formed "draft" of the resource (pre-generate its id, slug, and any derived fields) and stash it in the payment's `metadata` column (e.g. `metadata.pendingListing`). The checkout call itself takes `resourceId: null` on the payment.
2. At the single finalize/webhook choke point that handles a verified `payment_succeeded` event, if the payment's resource id is null, read the draft back out of `metadata` and `INSERT ... ON CONFLICT DO NOTHING` (no explicit target, so it catches a conflict on *either* a slug unique index or a website/other unique index) inside the same transaction that credits the payment.
3. If the insert is dropped by the conflict (a concurrent payment for another draft won the race), mark the payment `requires_reconciliation` with a descriptive `failureMessage` instead of silently dropping or duplicating. The loser payment must never be treated as succeeded, and a human/ops flow resolves it later.
4. If the insert succeeds, use the newly created row's id for the payment's resource id and any ledger entries, in the same DB update as the "succeeded" status transition.

**Why:** This guarantees zero garbage rows from abandoned/declined checkouts (a huge UX and data-integrity win versus eager-insert-then-rollback), while still resolving same-slug/same-website races deterministically without a distributed lock -- the database's own unique index is the race referee, and `finalize()`'s single-writer-per-payment-row transaction (`for("update")`) makes the check-then-insert atomic per payment.

## How to apply

- Any idempotency-key replay check that used to compare `payment.resourceId` against the request also needs a fallback comparison against a field *inside* the stashed draft (e.g. draft's website), since `resourceId` is always null for this class of payment until it succeeds.
- A generic "preview" response (e.g. showing a projected rank/listing before payment) should render straight from the draft object, not from a DB row -- do not create a throwaway row just to reuse existing serialization code.
- Any code path that assumes a payment's resource id is always non-null (e.g. a refund handler) needs a narrow runtime guard, since it is only truly guaranteed once `finalize()` has run.
- Test this by driving the same `finalize()`/`processVerifiedPaymentEvent`-equivalent function directly for two payments whose drafts collide on the unique field, and asserting: exactly one resource row exists, the loser is `requires_reconciliation` (not `failed`, not silently dropped), and no ledger entry was written for the loser.
- Client pitfall: the pre-payment draft/preview object usually has placeholder values for anything only computable post-persistence (e.g. a hardcoded rank of 0, a zeroed bid). If the frontend's post-payment success UI is set directly from that same captured object (instead of refetching the now-real resource after the payment-completed callback fires), it will display those placeholders as if they were final -- looks like "amount charged: $0" even though the real charge succeeded. Always refetch the persisted resource for the success screen.
