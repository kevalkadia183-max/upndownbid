---
name: users.email column is never the identity source
description: In this app's users table, the stored email column is intentionally always blank; identity/email is resolved live from Clerk per request, never persisted.
---

The `users` table's `email` column is intentionally left `null` on creation and never backfilled. Verified email is resolved live from the Clerk session on every request (`verifiedClerkEmail()` in `lib/moderation.ts`) and merged onto the in-memory actor object — the stored column is explicitly "historical/profile data" that must never establish identity or ownership.

**Why:** Clerk is the single source of identity so a stale or spoofed stored email can never grant ownership or role access. A comment in the code makes this explicit.

**How to apply:** Never write `WHERE email = '...'` against the `users` table when seeding/promoting a test user's `role` (e.g. to `admin`/`moderator`) via a direct DB step — it silently matches zero rows. Look the user up by `clerk_user_id` (or the internal `id`, cross-referenced via a listing's `owner_id`/`owner_email` or another table that does store the email) instead.
