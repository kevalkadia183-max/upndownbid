---
name: Admin settings should display the resolved effective value, not raw null
description: A site-setting that falls back to a built-in server-side default when unconfigured must show that default in the admin editor too, not a blank input.
---

When a site-setting is optional and the backend falls back to a built-in default constant whenever no row exists yet (e.g. "null means admin hasn't overridden it"), the admin editor for that setting must display the live *effective* value — the same one other code paths (checkout, public availability endpoints) actually use — rather than binding directly to the raw `null` and rendering a blank input.

**Why:** an admin who opens a brand-new settings panel with a blank price/duration field cannot tell whether the product is unconfigured/broken or simply using an undisplayed built-in default; a blank field also invites accidentally saving `null` (a no-op) while believing a value was set.

**How to apply:** fetch the already-resolved value from whichever public endpoint (or shared helper) applies the same fallback logic the real feature uses, and use that as the input's display fallback when the raw setting is `null` — don't duplicate the default as a second hardcoded constant in the frontend, since that can drift from the backend's real default.
