---
name: Campaign test fixture isolation
description: How immutable campaign history affects test data created before rollover assertions.
---

Weekly winner snapshots are derived from verified campaign ledger history, not only currently active listings. Archiving a listing changes public availability but does not erase or exclude its already-verified campaign ranking power.

**Why:** Campaign results must stay auditable and immutable. A temporary high-valued test listing can therefore still become the winner in a later rollover assertion, even if that listing has been archived.

**How to apply:** When tests share an isolated campaign, keep temporary verified bid values below any explicit rollover-winner fixture, or run them in a separately scoped campaign. Do not weaken winner calculation or remove ledger history merely to clean up test data.
