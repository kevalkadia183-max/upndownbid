---
name: Sponsorship demo seed vs. test isolation
description: Why demo/dev sponsorship seed data must never run under NODE_ENV=test
---

Demo listings in SignalRank/UpDownBid have no real owner account (`ownerId` is
empty), so the real `/sponsorships/checkout` flow (which requires the caller
to own the listing) can never be used to seed them. Demo sponsorships are
therefore inserted directly into `sponsorships`/`payments` (mirroring how
`initialLedger`/`initialOwnerLedger` already bypass real endpoints), gated
behind the same `SEED_DEMO_DATA=true` / local-dev convenience switch used for
the rest of `ensureSignalRankSeed`'s fake content.

**Why:** `sponsorships.test.ts` exercises the real 4-slot cap using fresh
listings/owners it creates itself, and never cleans up other fixed-id
sponsorship rows. If demo sponsorship seeding ran under `NODE_ENV=test` too,
it would permanently occupy all 4 slots in the shared dev DB and make every
`purchaseSponsorship()` call in that suite fail with "All Featured slots are
currently taken."

**How to apply:** Any seeding that creates sponsorship/slot-occupying rows
outside a test's own fixtures must be explicitly skipped when
`process.env.NODE_ENV === "test"` -- don't rely on the general
`shouldSeedDemoContent` gate alone, since that gate is intentionally `true`
in both the test suite and local dev opt-in.
