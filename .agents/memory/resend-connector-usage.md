---
name: Resend integration uses the connector proxy, not a raw API key
description: This project's Resend integration is a Replit connector, not a RESEND_API_KEY secret.
---

Accepting the Resend integration here attaches a Replit connector, not a
`RESEND_API_KEY` env var. Server code must send mail through the connector's
authenticated proxy rather than the `resend` npm package with an API key.

**Why:** The connector authenticates with Replit's own refreshing identity
token, not a static key, so there is nothing to store or rotate — and no
`RESEND_API_KEY` will ever appear in the environment for this integration.

**How to apply:** When wiring or debugging outbound email in this project,
look for the connector proxy usage (`@replit/connectors-sdk`), not an API
key. To check whether delivery is configured, check for the Replit identity
env vars, not a Resend key.
