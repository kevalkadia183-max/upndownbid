---
name: Advisory lock must guard every writer, not just the scheduler
description: A resource whose lifecycle sweep uses a Postgres advisory lock needs every other writer of that resource's status to take the same lock, not just the sweep itself.
---

When a scheduled sweep (e.g. expiring/releasing stale reservations) takes a
Postgres advisory lock for its whole read-then-write, any *other* code path
that can also transition the same resource's status (e.g. a payment
webhook/finalize activating it) must acquire that exact same lock before its
own read-then-write, or the two can interleave: the sweep reads "still
pending", the other path activates and commits in between, and the sweep's
now-stale decision still gets written on top of it (or vice versa).

**Why:** it's tempting to add the lock only where the resource-status code
was originally written (e.g. the sweep) and treat a payment/webhook handler
elsewhere as "just another writer that happens to update the same row" --
but a row-level `FOR UPDATE` lock on that handler is not equivalent
protection, since the sweep's query for candidates and the handler's lookup
by a different key (e.g. payment id vs. resource id) don't naturally
serialize against each other without the shared advisory lock.

**How to apply:** whenever introducing a resource with its own
status-expiry/release sweep guarded by `pg_advisory_xact_lock`, audit every
other transaction that can flip that resource's status (activation on
payment success, cancellation, admin actions) and make sure each acquires
the identical lock key before touching the row. Put the lock key in a
shared constants module so it can't drift or get redefined per-file. As
defense in depth, also guard the actual `UPDATE ... WHERE` clause with the
status value that was just read, so even a missed lock site fails safe
(0 rows affected) instead of silently overwriting.
