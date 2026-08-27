---
name: Ledger/ranking totals vs review-derived stats scoping
description: Which listing/campaign stats must stay unfiltered by a bidder's later ban status vs. which must exclude a banned/suspended user's contribution.
---

When auditing "does this stat leak archived listings or banned users," two families of derived numbers on a listing need opposite treatment:

- **Ledger-entry-derived dollar totals and ranking fields** (ownerBid, communitySupport, penalties, effectiveBid, supporters/penalizers counts, trend, and the weekly leaderboard rank itself) must **NOT** be filtered by the bidder's current user status. The authoritative weekly rollover (`closeCampaign`/`totalsFor` in `lib/campaigns.ts`) computes the eventual winner from every verified ledger entry regardless of the bidder's status at rollover time, and never re-checks status later. Filtering only the live/public view by ban status would make the live leaderboard diverge from what the campaign will actually finalize to, and would violate the "payment ledger finality" invariant (ranks change only from verified payment/refund events, not from unrelated account-status changes).
- **Review-derived signals** (rating, reviewCount, and which individual reviews are shown) are NOT part of the ranking algorithm at all, so they should exclude reviews authored by suspended/banned users, the same way `/analytics/public`'s `totalReviews` already does. A null `review.userId` (anonymous/legacy review) counts as active, since there is no account to have been banned.

**How to apply:** when adding a new active-listing/non-active-user filter for a "stats leak" audit, apply it to reviews and any review-sourced aggregate, but leave ledger-entry-derived dollar totals and rank alone. Archived-listing filtering (excluding a listing that is no longer `status: "active"`) is a separate axis and should still apply to both families.
