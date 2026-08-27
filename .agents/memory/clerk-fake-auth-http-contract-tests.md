---
name: Faking Clerk auth for backend HTTP contract tests
description: How to impersonate a signed-in Clerk session in a Node test that hits a real Express route over HTTP, without Clerk credentials or network calls.
---

`@clerk/express`'s `getAuth(req)` throws unless `req.auth` is a function branded with the
well-known symbol `Symbol.for("@clerk/express.auth")` (Clerk's own middleware sets this same
global-registry symbol, so a test file can reproduce it without importing any Clerk internals).
The function must return an object shaped like Clerk's signed-in/signed-out auth object:
`{ tokenType: "session_token", userId, sessionClaims, sessionId, sessionStatus, orgId, orgRole,
orgSlug, orgPermissions, factorVerificationAge, getToken, has, debug, isAuthenticated }`.

**Why:** this lets a `node:test` HTTP contract test exercise an app built via a `createApp({
clerkAuthMiddleware })` factory override, hitting real routes with `fetch()` against an
ephemeral `app.listen(0)` server, and asserting real response bodies parse against the generated
Zod response schema — the only way to catch a route whose serializer silently drifts from a
shared/extended schema (see response-schema-serializer-drift.md).

**How to apply:** set `sessionClaims` to include a verified email claim (e.g. `{ email,
email_verified: true }`) when faking a signed-in user — this repo's `verifiedClerkEmail()` helper
falls back to a real `clerkClient.users.getUser()` network call whenever the claim is absent,
which is slow and pointless against a fake user id. Seed the moderator/admin user directly in the
test's disposable database with a matching `clerkUserId`, then drive requests with a header (e.g.
`x-test-clerk-user-id`) that the test's fake middleware reads to decide which identity to attach.
