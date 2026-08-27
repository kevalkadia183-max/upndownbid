---
name: Clerk custom sign-up API
description: The installed Clerk React package exposes the current SignUpFuture custom-flow API used by owner onboarding.
---

Use the current Clerk React custom flow: call `signUp.password({ emailAddress, password })`, then `signUp.verifications.sendEmailCode()` and `signUp.verifications.verifyEmailCode({ code })`; when `signUp.status` is complete, call `signUp.finalize()`.

**Why:** The installed SDK does not expose older `isLoaded`, `setActive`, `prepareEmailAddressVerification`, or `attemptEmailAddressVerification` methods on `useSignUp()`, so copying legacy examples causes frontend type failures.

**How to apply:** Inspect the installed Clerk types and the local Clerk skill before implementing custom web onboarding; use `fetchStatus` for loading state and finalize the session before authenticated API calls.