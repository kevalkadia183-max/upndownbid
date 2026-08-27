---
name: Development schema alignment
description: Development database schema sync behavior when Drizzle detects legacy column names.
---

When the checked-in Drizzle schema is ahead of the development database, use the repository’s normal database push flow and preserve existing data through semantic column renames. In this environment, Drizzle’s rename selector requires a pseudo-terminal; non-interactive shell attempts can report an error or hang without applying changes.

**Why:** The API can build and start while a stale development schema still causes runtime 500s, and the push command’s conflict prompts are not answerable through a plain non-TTY runner.

**How to apply:** Inspect the current columns first, run the package’s supported push command through a PTY when conflicts are detected, choose semantic renames rather than creating duplicate fields, then restart the affected workflow and rerun the blocked user journey.