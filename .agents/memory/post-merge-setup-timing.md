---
name: Post-merge setup timing
description: Environment timing constraint for the automatic dependency, database, and workflow setup after task merges.
---

The automatic post-merge setup needs a five-minute timeout in this workspace because a frozen pnpm install can take roughly three minutes before database setup begins.

**Why:** A 20-second default and a 60-second retry both timed out even though the install was progressing normally; the schema and audit steps then completed quickly once given enough time.

**How to apply:** Keep the setup script non-interactive and idempotent, but configure enough timeout buffer for a cold or partially refreshed dependency install rather than removing the install step.