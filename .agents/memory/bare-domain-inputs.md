---
name: Bare domain inputs
description: Accepted website formats for public product entry.
---

Public website fields accept either a plain domain (such as `example.com`) or an explicit HTTP/HTTPS URL, and normalize accepted values to canonical HTTPS URLs.

**Why:** Visitors commonly paste a domain without a protocol; treating that as invalid interrupts product entry without improving safety.

**How to apply:** Keep API contract validation, route validation, and UI guidance aligned. Add `https://` only when no URL scheme was supplied, then apply existing hostname and path normalization.