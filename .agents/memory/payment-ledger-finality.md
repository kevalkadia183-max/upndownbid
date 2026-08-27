---
name: Payment ledger finality
description: The non-browser payment finalization rule and accounting invariants for SignalRank.
---

Payment checkouts are requests, not ranking mutations. Only a verified server-side
provider event may create a principal ledger entry; ranks aggregate those verified
entries net of linked verified refund entries. Payment, provider event, refund, and
receipt records are retained as the auditable lifecycle around that principal entry.

**Why:** A browser confirmation, a retried provider event, or an uncorrelated refund
must never create, duplicate, or reverse a ranking contribution.

**How to apply:** Keep real provider adapters fail-closed until they verify raw webhook
signatures, bind provider IDs and amounts to the stored payment/refund, use request and
event idempotency, and serialize refundable-balance changes. Do not add a client-side
"payment succeeded" path that writes the ledger or updates ranking state.

A provider's "net" settlement field can exclude tax or fees while the checkout record
tracks the gross customer charge; do not compare the stored gross directly to a net-style
field alone, or a valid paid checkout can fail reconciliation.

**Why:** A real test checkout for 1,000 cents settled with a lower net amount once tax
was deducted. Comparing the net value alone correctly failed closed, but also left a
valid paid checkout unreconciled.

**How to apply:** Preserve amount validation, but derive the provider's authoritative
gross charge (including tax/fees where applicable) before comparing it with the stored
checkout amount. Retest duplicate delivery and refund paths after changing this logic.