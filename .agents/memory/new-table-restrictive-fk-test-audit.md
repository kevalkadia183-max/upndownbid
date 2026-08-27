---
name: New table with restrictive FKs breaks existing test cleanup
description: Adding a table with onDelete:"restrict" FKs to widely-shared tables requires auditing every existing test file's cleanup, not just the new test's own.
---

A new table with `onDelete: "restrict"` foreign keys to widely-shared tables
(e.g. `payments`, `users`) can break other, unrelated tests' cleanup hooks
across the whole suite, not just the new feature's own test file.

**Why:** Existing `after()` hooks were written before the new table existed,
so they delete parent rows with no awareness a child table now references
them. The failure surfaces in a previously-passing, unrelated test file and
looks disconnected from the actual change.

**How to apply:** After adding a restrictively-FK'd table, audit every test
file that deletes rows from the referenced parent tables and add matching
child-row cleanup in dependency order — don't just fix the new test's own
teardown. Also, if the feature schedules related work as an un-awaited
background task after commit, a child row can still be inserting when
cleanup runs; make select-then-delete cleanup retry a few times instead of
assuming one pass is race-free.
