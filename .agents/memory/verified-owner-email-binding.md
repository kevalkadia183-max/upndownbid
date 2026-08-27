---
name: Verified owner email binding
description: Ownership association rule for Clerk-backed accounts and legacy listings.
---

Only a verified Clerk email may associate an authenticated account with a legacy owner-email listing. Browser-submitted receipt or contact emails, and values stored in editable user profiles, must never establish account identity or ownership.

**Why:** Treating a request email or a database profile email as proof of identity lets an authenticated person submit another owner's email and acquire management access.

**How to apply:** Resolve the actor's email from verified Clerk session claims or the Clerk backend before comparing it to a legacy listing. Keep anonymous legacy/email flows separate from account ownership, and derive all authenticated claim receipt/owner email values from the verified identity.