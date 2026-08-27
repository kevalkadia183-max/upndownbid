---
name: Dev DB legacy+renamed column coexistence
description: A prior column rename can leave both the old and new column names present simultaneously in the dev database.
---

A prior schema rename (e.g. `avatar_url` → `photo_url`) can leave *both* the old and new columns physically present in the dev database if the rename was applied by adding the new column without ever dropping the old one — the app code only reads/writes the new name, but the old one silently lingers.

**Why:** discovered when pushing an unrelated new table via `drizzle-kit push --force` surfaced both `avatar_url`/`photo_url`, `role_title`/`profile_role`, and `website_url`/`website` coexisting on `users`.

**How to apply:** Before dropping suspected-stale legacy columns, verify with a read-only query that every row has them empty/null (no real data would be lost). If confirmed empty, it's safe to let `drizzle-kit push --force` (or the project's non-interactive push script) drop them — this also avoids the interactive rename-vs-add prompt, which needs a PTY unavailable in a plain shell.
