---
name: Owner bid target serialization
description: How concurrent owner-bid targets remain aligned with the immutable payment ledger.
---

Owner-bid submissions express a desired campaign total, not an independent contribution. Serialize each owner-bid calculation per listing before deriving and charging the delta; a later target must be recalculated from the newly verified total.

**Why:** Concurrent requests that both derive a delta from the same old total can each be charged in full, making the ledger exceed either requested target and disagree with the listing's cached owner-bid amount.

**How to apply:** Any path that changes an existing owner's bid—public campaign entry, management link, or authenticated owner edit—must share the same per-listing lock. Regression coverage should use two distinct idempotency keys with different simultaneous targets and assert the final listing amount equals the sum of owner-bid ledger entries.

For provider-backed owner bids, an unresolved checkout reserves that listing's owner-bid slot. Treat both `pending` and `requires_reconciliation` as blocking until a definitive terminal outcome is recorded; only an exact idempotency-key replay may retrieve the same checkout.

**Why:** A provider can settle an ambiguous checkout after local reconciliation marks it, so allowing a new target before that point risks charging and crediting both bids.

**How to apply:** Lock the listing before creating a provider checkout, check unresolved owner-bid payments for the same campaign, and test both concurrent distinct-key requests and the reconciliation-required state without contacting a real provider.

The sandbox payment, verified owner-bid ledger entry, and cached owner total must also share that locked database transaction.

**Why:** A failed cached-total write after payment finalization otherwise leaves the immutable ledger ahead of the listing value displayed to users.

**How to apply:** Use transaction-aware payment finalization from the owner-target lock, and retain a regression that forces the cached listing update to fail and confirms no new payment or ledger entry persists.