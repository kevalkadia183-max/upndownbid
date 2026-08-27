---
name: Transaction query serialization
description: PostgreSQL transaction clients cannot safely execute overlapping queries.
---

Queries issued through one transaction client must be awaited sequentially; parallelize only independent queries that use separate pooled clients.

**Why:** node-postgres warns when a client is already executing a query, and a future driver release may reject the overlap. Removing the transaction to allow concurrency would weaken snapshot consistency.

**How to apply:** Keep repeatable-read or other consistency-critical transactions intact, but replace `Promise.all` over transaction-bound queries with ordered awaits.