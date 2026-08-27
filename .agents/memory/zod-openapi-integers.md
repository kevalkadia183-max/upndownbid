---
name: OpenAPI Zod schema compatibility
description: Generated Zod validators in this workspace require compatibility-safe ways to express integers and string validation.
---

Use OpenAPI `number` schemas with `multipleOf: 1` for whole-number requirements, and use `pattern` for URL/email-like string validation. Do not use `integer` or `format` helpers until the workspace's Zod and generator versions are aligned.

**Why:** The current generator emits Zod 4-only helpers (`zod.int()`, `zod.url()`, `zod.email()`, and `zod.stringFormat()`) for OpenAPI integer/format declarations, while the installed Zod 3 runtime does not export them. `multipleOf` and `regex` generate Zod 3-compatible validators.

**How to apply:** Use the same `multipleOf` and regex rules in generated contract schemas and server-side public validators. Keep any follow-on normalization after that shared validation.