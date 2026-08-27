---
name: Cleanup scripts must filter by real FK, not timestamp/naming heuristics
description: Why a test-data deletion plan must join every child row (payments, ledger entries) to its actual owning listing_id/user_id before deleting, instead of trusting creation-time proximity or naming patterns.
---

When preparing a deletion script that removes "test/seed" rows and keeps a specific set of protected parent rows (e.g. protected listings), do not assume a payment/ledger/child row belongs to a test fixture just because it was created in the same batch or around the same timestamp as other fixtures.

**Why:** In a SignalRank/upndownbid.lol production cleanup, an owner-bid payment and its ledger entry for a real, protected listing ("Makunto") were created at essentially the same instant as a batch of unrelated test-suite listings. A plan built from timestamp/id-pattern heuristics alone would have deleted that payment and ledger entry — permanently erasing a real listing's paid creation record — even though the listing itself was correctly flagged as protected. The mistake was only caught by explicitly re-querying every payments/ledger_entries row's `listing_id` and joining it against the protected-listing id set.

**How to apply:** Before finalizing any destructive cleanup script, re-fetch the full child table (payments, ledger_entries, reviews, etc.) with its actual foreign key column, and cross-check every row's FK target against the protected-ID allowlist — never rely on "looks like a test fixture" naming or "was created around the same time" reasoning. Also walk the schema for every table with `onDelete: "restrict"` pointing at the tables being purged (e.g. payment_events/payment_receipts referencing payments) so deletion order doesn't fail partway through a transaction.
