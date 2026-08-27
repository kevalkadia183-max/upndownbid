---
name: Fire-and-forget delivery vs test cleanup races
description: Background invoice/email delivery jobs can insert rows after a test's cleanup already queried them, causing an FK violation in after().
---

`triggerInvoiceDeliveryForPayment` (and similar "schedule after commit, never await" background jobs) is intentionally fire-and-forget in production code. A test suite's `after()` cleanup that does SELECT child ids → DELETE children → DELETE parent is not atomic against that job: it can still be in flight and insert a new child row (e.g. `invoice_email_deliveries`) in the gap between the SELECT and the parent DELETE, producing a foreign-key violation that fails the whole test file rather than the specific test.

**Why:** Production code correctly never awaits post-commit delivery jobs (delivery must not block the response or be inside the transaction). Test cleanup that assumes "no more child rows will appear" after one SELECT is therefore inherently racy, and more tests creating more deliveries near the end of a run makes the race easier to hit.

**How to apply:** In test-file `after()`/cleanup helpers that delete a parent row with a child table fed by a fire-and-forget job, wrap the delete in a small retry loop (re-select child ids, re-delete children, retry parent delete a few times with a short backoff) instead of a single SELECT-then-DELETE pass. Do this in the test file only — do not add awaits or synchronous coupling to the production delivery path to "fix" this.
