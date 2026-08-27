---
name: PayPal sandbox verification
description: Lessons from running one controlled real PayPal sandbox payment end-to-end (account isolation, secret propagation, webhook replay testing, webhook-to-app scoping).
---

## PayPal sandbox account/app isolation
A newly-created sandbox "app" can silently stay linked to an old/default business account instead of the one you just created.
**Why:** trusting the dashboard's app-creation flow without checking is not enough — one round of "new" credentials still resolved to the old merchant account, and a mismatched merchant ID makes the server reject the capture as an unverified payee.
**How to apply:** before running a real payment test, verify via a live order-creation + GET call that the returned payee identity actually matches the intended account, and diff that against the configured merchant-id secret. PayPal's create response can contain only the order ID, status, and links; retrieve the order before expecting `purchase_units[].payee.merchant_id`. Do not assume a new app is properly isolated just because it was "created".

## Secret updates may not propagate immediately
**Why:** a secret can appear "saved" in the UI flow while the value observed by a running process (or even a fresh shell) is still the old one — in one case the user had re-confirmed the existing value without actually replacing it.
**How to apply:** never trust a "secret saved" confirmation alone when the new value is safety-critical (e.g. must match a live external account). Verify by comparing the live value against an independently-derived expected value, and if it still doesn't match, ask the user to explicitly edit (not just re-confirm) the field.

## Webhook replay / idempotency testing
**Why:** the safest way to prove a webhook handler is idempotent against real provider redelivery (not just a fabricated duplicate) is to have the provider itself resend the exact same event.
**How to apply:** use the provider's official webhook-resend API rather than replaying a captured payload by hand. A resend can be accepted immediately but only actually delivered after a delay of a minute or more — don't conclude failure from a short wait; poll logs.

## A PayPal webhook is scoped to one app, not the merchant account
**Why:** a webhook ID created under a different PayPal REST app (different Client ID/Secret pair) in the same developer dashboard returns `INVALID_RESOURCE_ID` (404) when looked up with another app's OAuth token, even though both apps belong to the same live business account. It's easy for a user to create a "new" webhook under the wrong app and assume it's usable everywhere.
**How to apply:** before trusting any webhook ID a user hands you (or one already configured), fetch it with `GET /v1/notifications/webhooks/{id}` using an OAuth token from the *exact* Client ID/Secret pair the app will run with, and diff its `url` against the actual production domain (from `getDeploymentInfo()`, not assumed) and its `event_types` against the code's expected event whitelist. A 404 here means wrong app, not a bad ID.
