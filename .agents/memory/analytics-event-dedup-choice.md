---
name: Analytics event dedup choice
description: Whether a new lightweight analytics/tracking table should dedupe per visitor or log every event, in the signalrank (upndownbid) app.
---

When adding a new low-stakes tracking table (impressions, views, clicks) modeled on the existing `listing_clicks` / `listing_demo_views` pattern, choose the index style based on what the event *means*, not by copying whichever example is closest at hand:

- **Deduplicated (unique index per visitor+target)** — for a counter meant to represent "how many distinct people have done X once," e.g. a demo-view count shown publicly. Re-triggering it from the same browser must not inflate the number.
- **Unenforced/plain index (log every occurrence)** — for an event that is legitimately repeatable and each occurrence is meaningful on its own, e.g. a website click, or a homepage popup impression that can validly recur once per new browser session even for the same listing.

**Why:** copying the wrong one silently produces either an inflated public-facing counter or an undercounted internal log — the two tables in this codebase (`listing_demo_views` vs `listing_clicks`) intentionally differ for this reason.

**How to apply:** before creating a new `listing_*` (or similar) tracking table, ask "should re-triggering this from the same browser count again?" — yes → plain index, no → unique index.
