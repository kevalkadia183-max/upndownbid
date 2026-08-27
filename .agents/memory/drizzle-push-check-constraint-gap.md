---
name: drizzle-kit push does not alter existing CHECK constraints
description: Changing a table's check() clause in Drizzle schema source is not detected by push/push-force against a database where the table already exists.
---

Editing a `check()` expression on an existing column (e.g. widening an allowed
enum-like set of string values) and running the project's normal push flow
does not alter the constraint in a database where the table already exists.
The push reports success, but the old constraint stays in place and the next
insert/update matching the new values fails with a check-constraint
violation, not a schema/type error — so it slips past typecheck and looks
like an application bug instead of a missed migration.

**Why:** drizzle-kit's diffing does not reliably pick up in-place CHECK
constraint changes on push; it only reliably applies them when the table is
created fresh (e.g. a disposable test database built via push-force from
scratch).

**How to apply:** After changing a `check()` clause on a column that already
has data, verify the live constraint definition in the target database
(query `pg_constraint` / `pg_get_constraintdef`) rather than trusting a clean
push run. If it's stale, manually `ALTER TABLE ... DROP CONSTRAINT` +
`ADD CONSTRAINT` with the new expression, matching the schema source exactly.
