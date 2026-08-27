---
name: Clerk testing via programmatic auth
description: How to get a testing subagent past Clerk sign-in/sign-up in this environment without scripting the hosted UI.
---

Clerk's hosted sign-up/sign-in widgets (Google button, email/password form) are blocked by a Cloudflare "verify you are human" bot challenge in this workspace's testing environment — a testing subagent cannot Playwright-script its way through them, no matter how the credentials or `+clerk_test` conventions are set up.

**Why:** repeated attempts to drive the real hosted UI (both Google OAuth and email/password) hit the Cloudflare gate and produced unreliable, non-reproducible test runs.

**How to apply:** write test plans with an explicit `[Clerk Auth] Sign in as {firstName, lastName, email}` step instead of any step that clicks into Clerk's widgets. The testing skill's programmatic Clerk login signs a real session in directly, entirely bypassing the hosted UI and the Cloudflare gate, and works reliably for exercising post-auth app behavior (redirects, resumed state, authenticated API calls).
