---
name: SignalRank admin actions use native confirm()
description: Admin dashboard moderation/status/role actions gate on window.confirm(); a testing subagent that doesn't register a dialog handler before clicking sees zero network calls, not a real bug.
---

The SignalRank (upndownbid) admin dashboard (`pages/admin.tsx`) wraps moderation-status changes, listing status toggles, and user role/status changes in a plain `window.confirm(message)` call before firing the API request.

**Why:** a Playwright-based testing subagent that clicks the trigger without first registering a `page.on('dialog', ...)` handler (or otherwise auto-accepting) will have the confirm silently return `false` (or hang), so `runAction`/the mutation never fires — the UI looks inert and the DB is unchanged. This looks exactly like a broken feature but is a test-harness artifact, confirmed by zero matching requests in server logs.

**How to apply:** before reporting one of these admin actions as broken from an e2e run, check the API server logs for the expected request. If it never arrived, first re-test with explicit native-dialog handling instead of concluding the app is broken.
