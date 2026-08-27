---
name: Provider error privacy
description: Safe logging rule for hosted payment-provider failures.
---

Never write raw hosted-payment provider error messages to server logs. Provider validation payloads can echo the submitted customer email and checkout metadata.

**Why:** A debugging attempt showed that a payment provider’s validation message contained the visitor’s email address, which must not become routine application log data.

**How to apply:** Log only a payment identifier and a safe error classification or status. Return a clear generic failure to the browser, and use controlled diagnostics only when they do not include customer-submitted values.