---
name: Community bid refund policy
description: Product policy for refunds and ledger reversals on successfully paid community bids.
---

Successfully paid `COMMUNITY_BID` payments are non-refundable. Do not create, process, replay, or simulate a refund for them, and do not create a reversal ledger entry.

**Why:** Community bids represent finalized community signals; refunding one would invalidate the verified payment and leaderboard evidence.

**How to apply:** Keep community-bid verification focused on payment, webhook, ledger, duplicate-delivery, and leaderboard behavior. Treat any refund request for a successfully paid community bid as out of scope unless the product policy explicitly changes.