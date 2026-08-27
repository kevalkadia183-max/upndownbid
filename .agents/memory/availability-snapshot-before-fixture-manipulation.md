---
name: Availability snapshot before fixture manipulation
description: Take "before" occupancy/availability snapshots before backdating test fixtures, not after, when the availability function computes state live from timestamps.
---

When a test proves "an expiration sweep frees a slot" (or any similar before/after occupancy/availability check), capture the "before" snapshot while the fixture is still in its genuine, not-yet-manipulated state — never after backdating a timestamp (e.g. setting an `expiresAt` column into the past) to simulate expiry.

**Why:** availability/occupancy functions often compute state live from stored timestamps compared to "now" (e.g. `expiresAt < now`), independent of whether a scheduled sweep has actually run yet. Backdating the fixture *before* capturing the "before" snapshot makes that row already read as free/expired, so the "before vs after the sweep" assertion becomes vacuous (the count never actually changes) and can even fail on an off-by-one.

**How to apply:** capture the baseline snapshot immediately after creating the fixture in its real state, then backdate it, then run the real code path under test (e.g. the sweep), then snapshot again and diff. Never snapshot after any test-only mutation of the very timestamps the availability function reads.
