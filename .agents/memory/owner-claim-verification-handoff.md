---
name: Owner claim verification handoff
description: How an unauthenticated product claim resumes safely after Clerk account verification.
---

New-owner claims must hand off password and email verification to Clerk’s complete sign-up flow. Keep only the non-secret claim details needed to resume checkout in browser session storage, and submit the bid only after the app receives an authenticated session.

**Why:** A one-step programmatic sign-up cannot complete Clerk’s verification-required states and either strands the owner or risks treating an unverified identity as an account holder. Persisting a password to resume the form would create an unnecessary secret-handling boundary.

**How to apply:** Stage the URL, category, bid, owner name, and receipt email; redirect to the owner sign-up route; restore the staged checkout when Clerk redirects with a verified session; then clear the staged data after successful checkout. Never stage passwords, session tokens, or browser-supplied ownership identifiers.