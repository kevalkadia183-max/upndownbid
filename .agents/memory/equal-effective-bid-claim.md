---
name: Equal effective bid claims
description: The product rule for matching the live leader in a campaign.
---

An entered effective bid equal to the current highest effective bid is eligible to claim projected #1; it does not need an extra minimum-increment bump.

**Why:** The campaign’s minimum is the cost to enter, not a surcharge on the leading price. Showing a higher “reach #1” amount would misrepresent the live price to users.

**How to apply:** Use strict-greater-than comparisons when counting products ahead of a projected bid, and display the current leader’s effective bid itself as the #1 threshold.