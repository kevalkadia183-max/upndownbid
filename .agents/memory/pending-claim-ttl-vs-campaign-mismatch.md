---
name: Pending claim TTL vs campaign mismatch
description: Two distinct, differently-surfaced discard paths for a saved owner claim -- silent TTL expiry vs. a user-facing campaign-ended toast.
---

A pending owner claim saved to sessionStorage before an auth redirect can be discarded for two different reasons, with two different user experiences:

1. **TTL expiry** (older than the pending-claim TTL, e.g. 30 minutes) is dropped silently, no toast. This check runs first, inside the low-level "peek" helper.
2. **Campaign mismatch** (claim's campaign id doesn't match the live campaign, or the live campaign has ended) is dropped with a visible destructive toast ("This campaign has ended. Please start a new claim in the current campaign."). This check only runs for claims that already passed the TTL check.

**Why:** an ancient, likely-abandoned claim shouldn't interrupt the user with an error; a claim the user actively tried to complete but that rolled over to a new campaign should tell them clearly why nothing happened.

**How to apply:** when testing or debugging the campaign-mismatch toast specifically, seed the pending claim with a **recent** `createdAt` (e.g. `Date.now()`) and a mismatched/expired `campaignId`/`campaignEndAt`. Seeding an ancient `createdAt` (e.g. epoch) instead short-circuits at the TTL check and never reaches the campaign-mismatch path, silently passing without ever exercising the toast.
