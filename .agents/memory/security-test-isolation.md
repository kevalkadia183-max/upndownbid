---
name: Security test isolation
description: Rules for running database-backed security regression tests without contaminating shared data.
---

Security tests that exercise moderation actions must run in a disposable database rather than the shared development database.

**Why:** Moderation writes create audit events, and audit history is intentionally append-only. A shared-database test run cannot safely clean up those records, even when it restores ordinary fixtures. It can also leave development tables out of sync when a forced schema push has to resolve legacy column names.

Interrupted runners must clean up on SIGINT/SIGTERM, and uncatchable termination must be recoverable on a later run with a bounded stale-database sweep.

**Why:** CI cancellation can bypass normal `finally` cleanup, while SIGKILL cannot be handled by the process at all. Leaving disposable databases behind eventually exhausts the CI PostgreSQL service.

**How to apply:** Keep database provisioning, schema setup, and teardown inside the test runner. Preserve the audit guard in that temporary database, force-drop it after child shutdown, and use timestamped names plus an age/count-limited startup sweep for abandoned databases. Never run a forced schema push against the shared development database.

The runner's shared-source snapshot can also fail when an active development service changes ephemeral rate-limit rows while the disposable suite is running, even if every isolated assertion passes.

**Why:** The harness correctly rejects a run when its source snapshot changes, but rate-limit traffic from an active preview makes that protection noisy and can conceal whether a test itself leaked writes.

**How to apply:** Run this suite when shared development traffic is quiescent, or change the isolation design so ephemeral rate-limit activity cannot invalidate the source-database integrity check.