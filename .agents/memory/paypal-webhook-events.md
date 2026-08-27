---
name: PayPal webhook event handling
description: Which PayPal webhook events this single-merchant integration subscribes to, resource-id quirks, and why no merchant-id check is needed.
---

The platform subscribes to exactly six PayPal webhook events (never "all events", never subscription/partner/marketplace events): `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.PENDING`, `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.DECLINED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED`. Any other event type reaching the handler is signature-verified then safely acknowledged as a no-op (defense-in-depth against a dashboard misconfiguration), never rejected.

**Resource-id quirk:** most of these events carry the PayPal Order as `resource` with `resource.id` = order id (capture events instead carry a Capture with `resource.id` = capture id and the order id at `resource.supplementary_data.related_ids.order_id`). `CHECKOUT.PAYMENT-APPROVAL.REVERSED` is the outlier: its resource nests the order id at `resource.order_id`, not `resource.id`. Confirmed against PayPal's own sample payload (developer.paypal.com/v5/checkout/uncaptured-payments) — get this wrong and reversal webhooks silently fail to match their payment.

**Why:** `CHECKOUT.PAYMENT-APPROVAL.REVERSED` fires when PayPal auto-cancels an order that was approved but never captured within the time window (default 3h) and auto-refunds the buyer — treated as a `payment_cancelled` event, monotonic against an already-succeeded payment.

**No merchant-id / payee verification:** orders and captures are created and captured using the platform's own OAuth client credentials, with no `purchase_unit.payee` override and no partner attribution. PayPal guarantees funds land in the platform's own account by construction, so a `PAYPAL_MERCHANT_ID` equality check on the capture payee is redundant and was removed (do not re-add it, and do not ask for that secret, unless a payee override or partner/marketplace flow is introduced).

**How to apply:** sandbox and production use separate webhook IDs (`PAYPAL_WEBHOOK_ID` for sandbox, `PAYPAL_WEBHOOK_ID_LIVE` for production), selected by the existing triple-gated `payPalEnvironment()`. Webhook endpoint is `<origin>/api/paypal/webhook` (raw body, CSRF/origin-check exempt) in `artifacts/api-server`.
