# SignalRank payment operations

Payments are created as pending, idempotent local records. A ranking contribution
is written only after the server verifies a successful provider capture with the
stored amount and currency. Provider event IDs are idempotent, receipts are issued
only after finality, and stale pending records are marked for reconciliation.

The local `test` adapter remains available for development. Production checkout
uses PayPal Orders v2: the server derives USD amount from the local payment,
captures on the server, and verifies webhooks using the provider verification API.
Client secrets never leave the server.

## Sandbox end-to-end verification (2026-08-26)

A real PayPal sandbox buyer approved a $5.00 COMMUNITY_BID payment through the
public checkout UI (browser automation against the live PayPal sandbox login and
"Complete Purchase" review flow — not a mocked provider). `PAYMENT_MODE` and
`PAYPAL_ENVIRONMENT` stayed `sandbox` throughout, confirmed via the server's own
startup log (`"paymentMode": "sandbox", "livePaymentsEnabled": false`).

Server-side result, confirmed by direct database queries after the flow completed:

- One `payments` row, `status = succeeded` (PayPal order `948087739V4860137`,
  capture `1T733071F8626724X`).
- Exactly one `payment_receipts` row for that payment.
- Exactly one `ledger_entries` row for that payment (idempotency key
  `payment:<id>:principal`), and the listing's `effectiveBid` increased by
  exactly $5 (confirmed via `GET /api/listings/:slug`).
- Two `payment_events` rows: the direct capture confirmation
  (`capture:1T733071F8626724X`) and the real PayPal webhook delivery
  (`WH-0BE41136HH122945T-4GR154841M248454L`), both `signature_verified = true`.

Webhook replay test: the same webhook event was redelivered via PayPal's
`/v1/notifications/webhooks-events/{id}/resend` API (a real signed redelivery of
the same event ID, not a fabricated payload). After the redelivery landed
(`POST /api/paypal/webhook` returned 202 a second time), the database still showed
exactly one `payment_receipts` row and one `ledger_entries` row for the payment —
the resend was deduplicated via the `payment_events` unique
`(provider, provider_event_id)` constraint and created no new ledger or receipt
row, confirming the webhook handler's idempotency under real PayPal redelivery.