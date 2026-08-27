---
name: Owner claim identity source
description: The public owner-claim flow must derive identity from the authenticated Clerk session, never from email/name form fields.
---

The public "claim a spot" flow (campaign-bid-module.tsx and the `/public/campaign-bids` route it calls) collects only product details (URL, category, bid amount) from the visitor. It never renders an email or name input. Once the visitor is signed in with Clerk (either already, or immediately after completing sign-up/sign-in), the claim is submitted using `user.primaryEmailAddress` from the Clerk session; the server's own `actor.email` / `actor.displayName` resolution takes precedence over any submitted value anyway.

**Why:** the product owner previously had to type an "Owner email" (and, for new users, a name) into the claim form even though this data was always available from their Clerk account — pure friction, and it also opened a legacy path where a fully anonymous visitor could claim/increase a listing just by typing a matching email, with no account at all. The redesign made authentication mandatory for every claim through this UI and removed the fields entirely.

**How to apply:** if a future request asks to "add the email field back" or "let anonymous visitors claim without signing in," treat that as a deliberate scope change to flag back to the user, not a bug fix — the current design intentionally requires auth for every claim submitted through this flow. The server's anonymous/email-matching support in the route itself was left intact (it still matters for the secure "management link" flow on already-existing anonymous listings), so no backend schema changes were needed to make this UI change.
