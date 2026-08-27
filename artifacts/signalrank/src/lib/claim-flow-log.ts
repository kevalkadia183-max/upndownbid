// Structured breadcrumb trail for the owner-claim -> auth -> PayPal journey,
// so a broken run can be diagnosed from a single correlation id instead of
// guessing which step silently failed. Logs to the browser console only --
// this is a client-side complement to the server's pino event log, joined by
// the same correlation id (the claim's idempotency key, then the payment id
// once one exists).
//
// Never pass email, name, tokens, or PayPal identifiers as `details` -- only
// ids, booleans, counts, and enum-like status strings.
export type ClaimFlowEvent =
  | "AUTH_STARTED"
  | "AUTH_CALLBACK"
  | "SESSION_CONFIRMED"
  | "PENDING_TRANSACTION_SAVED"
  | "PENDING_TRANSACTION_RESTORED"
  | "PENDING_TRANSACTION_DISCARDED"
  | "CAMPAIGN_VALIDATED"
  | "BID_VALIDATED"
  | "PAYPAL_ORDER_CREATE_STARTED"
  | "PAYPAL_ORDER_CREATED"
  | "PAYPAL_CHECKOUT_RENDERED"
  | "PAYPAL_APPROVED"
  | "PAYPAL_CAPTURE_STARTED"
  | "PAYPAL_CAPTURED"
  | "TRANSACTION_FINALIZED"
  | "TRANSACTION_FAILED";

export function logClaimFlowEvent(event: ClaimFlowEvent, correlationId: string | undefined, details?: Record<string, unknown>) {
  console.info(`[claim-flow] ${event}`, { correlationId, ...details });
}
