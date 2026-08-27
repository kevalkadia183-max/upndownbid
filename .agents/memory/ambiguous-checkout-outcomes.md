---
name: Ambiguous checkout outcomes
description: How payment state should handle provider checkout calls whose outcome is unknown.
---

Only a confirmed provider rejection may transition a pending checkout payment to
failed. A timeout, connection reset, or other indeterminate response must remain
pending and be retried with the same internal and provider idempotency keys.

**Why:** A provider may have accepted the checkout just before the client loses
its response. Treating that outcome as failed can strand a real checkout or
encourage a second charge.

**How to apply:** Classify provider errors without logging their raw messages.
Persist the checkout ID only after it is returned; when persistence cannot be
confirmed, retain the pending payment and recover through the stable
idempotency key or provider lookup.