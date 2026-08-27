---
name: Weekly campaign boundaries
description: The authoritative weekly competition calendar and its rollover rule.
---

Campaigns run from Sunday 00:00 UTC through the following Sunday 00:00 UTC. The server, rather than browser time, determines the active campaign and performs rollover.

**Why:** A global UTC boundary gives every visitor the same finish instant and avoids local-time, daylight-saving, and client-clock disagreements in a bidding competition.

**How to apply:** Keep any timer, checkout eligibility check, ranking calculation, and finalization job aligned with the server-provided campaign window. Treat the configured minimum bid as campaign data rather than a frontend constant.

The listing-level owner-bid value is a cache for the live campaign, while completed campaign standings are immutable snapshots. Finalize the snapshot before clearing that cache during rollover.

**Why:** Carrying the current-week cache into the next campaign can make a fresh leaderboard or owner view show a bid that belongs only to the completed week.

**How to apply:** Keep finalization and cache reset in the same serialized rollover transaction, and verify a payment immediately before the boundary remains in the completed snapshot but not in the new campaign's live state.