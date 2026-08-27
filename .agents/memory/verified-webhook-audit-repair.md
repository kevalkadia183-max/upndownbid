---
name: Verified webhook audit repair
description: Preserve exactly one immutable payment audit record even for historical verified webhook events missing audit history.
---

Every accepted verified payment lifecycle event needs one audit entry tied to its internal payment and provider event. Duplicate deliveries must look for that exact event audit and insert it only if history is missing.

**Why:** A historical or out-of-band event can exist in the payment-event ledger without an audit row; treating every duplicate as a no-op leaves investigations permanently incomplete.

**How to apply:** Keep event creation and audit insertion transactional for fresh deliveries. On a duplicate, confirm the stored event belongs to the payment and is signature-verified before backfilling its audit record; preserve append-only history and test concurrent duplicate deliveries.