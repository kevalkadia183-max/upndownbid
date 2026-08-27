---
name: Same-origin host validation
description: Security rationale for validating mutating API request origins.
---

For mutating API requests, compare the parsed Origin host with the received Host header. Do not use forwarded-host headers as the origin authority.

**Why:** A client can supply a matching Origin and X-Forwarded-Host value to impersonate an allowed external host unless an infrastructure layer has already made that header authoritative.

**How to apply:** Keep an automated rejection case that sends a foreign Origin together with a forged forwarded host. If proxy topology changes, explicitly establish a trusted proxy boundary before relying on forwarded headers.

**Debugging tip:** a bare `curl` against such an app returns `{"error":"Same-origin requests are required"}` on mutating routes because curl sends no Origin header. Add `-H "Origin: https://$REPLIT_DEV_DOMAIN"` (matching the Host you're curling) to exercise the route manually.

**HTTP-contract test files:** this same-origin check applies app-wide to every non-GET/HEAD/OPTIONS `/api/*` route, not just payment/claim ones. Any new HTTP-contract test file (fake-`req.auth` style, e.g. `sponsorships.test.ts`) must set an `origin` header equal to the app's own base URL on every POST/PATCH/DELETE `fetch()` call, or the response is a spurious 403 that looks like an auth bug rather than a missing header.