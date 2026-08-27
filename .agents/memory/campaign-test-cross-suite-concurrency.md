---
name: Campaign test cross-suite concurrency
description: node:test runs api-server test files concurrently against one shared disposable database; campaign/ranking fixtures must account for that.
---

`node --test` (invoked by `test-security.mjs`) runs every `src/*.test.ts` file in the same disposable database concurrently, not in isolation per file. Any test that reads or mutates `campaigns`/`campaign_listings`/the "current live campaign" singleton (via `ensureCurrentCampaign()`) shares that state with every other test file running in the same pass.

**Why:** A test that forced a real weekly rollover (`ensureCurrentCampaign(oneWeekLater)`) to manufacture a "previous completed campaign" fixture picked up campaign numbers polluted by another suite's concurrently-inserted fixture (`moderation-security.test.ts` intentionally uses `Date.now()`-based random large numbers for its own ended-campaign fixture specifically to dodge collisions with sequential numbering). Forcing a real rollover also risks finalizing the campaign other concurrently-running suites assume is still live. Comparing two separate GETs of shared live-ranking data (e.g. `/api/listings` vs a live-mode board endpoint) can also flake if another suite's bid lands between the two requests.

**How to apply:** For a "previously completed campaign" fixture, hand-insert a `campaigns`/`campaign_listings` row with a campaign `number` picked to be trivially outside any real/other-fixture range (e.g. a large negative number, if the field has no positivity constraint) and a `startAt`/`endAt` far from any real week — never force a real rollover of the shared current campaign just to get a completed-campaign fixture. When an assertion must compare two separate endpoint reads of shared live data, retry the read pair a few times instead of asserting on a single snapshot.
