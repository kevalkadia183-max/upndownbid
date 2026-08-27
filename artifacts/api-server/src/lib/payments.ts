import { createHmac, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import {
  db, auditEventsTable, ledgerEntriesTable, listingsTable, paymentEventsTable,
  paymentReceiptsTable, paymentsTable, refundsTable, sponsorshipsTable, type Payment,
} from "@workspace/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { ensureCurrentCampaign } from "./campaigns";
import { logger } from "./logger";
import { createInvoiceForFinalizedPayment, syncInvoiceStatusForPayment, triggerInvoiceDeliveryForPayment, triggerInvoiceRefundNotification } from "./invoices";
import { SPONSORSHIP_LOCK_KEY } from "./advisory-locks";

export type PaymentType = "OWNER_BID" | "COMMUNITY_BID" | "PENALTY" | "SPONSORSHIP";
export type PaymentEventType = "payment_succeeded" | "payment_failed" | "payment_cancelled" | "payment_pending" | "order_approved" | "refund_succeeded" | "refund_failed";
export type CheckoutInput = {
  // Null only for a deferred new-listing checkout (no listing exists yet --
  // see PendingListingDraft). Every other checkout targets an existing
  // listing.
  listingId: string | null;
  // Null for a SPONSORSHIP checkout -- sponsorships are a fully separate
  // product from the weekly campaign and are never associated with one.
  campaignId: string | null; userId: string | null; type: PaymentType;
  amountCents: number; currency?: string; reason?: string; receiptEmail?: string | null;
  idempotencyKey: string; metadata?: Record<string, unknown>;
};
// Draft fields for a listing that does not exist yet. Stashed in a
// deferred-creation payment's `metadata.pendingListing` at checkout time and
// materialized into a real `listings` row inside finalize() only once the
// payment verifiably succeeds -- so an abandoned or declined checkout never
// claims a slug or website. `id` and `slug` are pre-computed at checkout
// time (same as before) so management links and the "success" response can
// reference them ahead of the row actually existing; a same-slug/website
// race at finalize time is resolved via onConflictDoNothing, with the loser
// marked requires_reconciliation.
export type PendingListingDraft = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  initials: string;
  accent: string;
  websiteUrl: string;
  demoVideoUrl: string | null;
  ownerId: string | null;
  ownerEmail: string;
  ownerName: string | null;
  managementTokenHash: string;
  managementTokenExpiresAt: string;
};
type EventInput = {
  provider: string; eventId: string; type: PaymentEventType; paymentId: string;
  providerCheckoutId?: string; providerPaymentId?: string; amountCents?: number; currency?: string;
  failureCode?: string; failureMessage?: string; payload?: Record<string, unknown>;
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PaymentError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly retryable?: boolean) {
    super(message); this.name = "PaymentError";
  }
}
export function isLivePaymentsEnabled() {
  return process.env.PAYMENT_MODE === "live" && process.env.PAYMENTS_LIVE_ENABLED === "true";
}
export type PayPalEnvironment = "sandbox" | "production";
export function payPalEnvironment(): PayPalEnvironment {
  // Production is deliberately triple-gated. A typo or partial rollout must
  // always use the sandbox endpoint rather than risking a real charge.
  return process.env.PAYPAL_ENVIRONMENT === "production" &&
    process.env.PAYMENT_MODE === "live" &&
    process.env.PAYMENTS_LIVE_ENABLED === "true"
    ? "production"
    : "sandbox";
}
export function isPayPalCheckoutEnabled() {
  return process.env.PAYMENT_PROVIDER === "paypal";
}
function provider() { return isPayPalCheckoutEnabled() ? "paypal" : "test"; }
export function paymentEnvironment(payment?: Pick<Payment, "provider" | "metadata">): "sandbox" | "live" {
  return payment?.provider === "paypal" && (payment.metadata as Record<string, unknown>)?.provider_environment === "production" ? "live" : "sandbox";
}
export function paymentRuntimeConfiguration() {
  return { nodeEnvironment: process.env.NODE_ENV ?? "development", paymentMode: process.env.PAYMENT_MODE ?? "unset", paymentProvider: provider(), livePaymentsEnabled: isLivePaymentsEnabled(), databaseTargetFingerprint: process.env.DATABASE_URL ? createHash("sha256").update(process.env.DATABASE_URL).digest("hex").slice(0, 16) : "unconfigured" };
}
export async function getPayment(id: string) {
  const [row] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1); return row ?? null;
}
function fee(cents: number) { return isLivePaymentsEnabled() ? Math.round(cents * .05) : 0; }
// Exported so lib/sponsorships.ts can create a sponsorship's payment row
// inside the same advisory-locked transaction that reserves its slot --
// sponsorship creation must never call createCheckout/createPayPalCheckout
// (which open their own transaction) since the payment row and the
// sponsorship row have to commit together, atomically, or not at all.
export async function createInTx(tx: Tx, input: CheckoutInput): Promise<Payment> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new PaymentError("Payment amount must be a positive whole number of cents");
  if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new PaymentError("A valid Idempotency-Key header is required");
  const currency = (input.currency ?? "USD").toUpperCase();
  const [made] = await tx.insert(paymentsTable).values({
    id: randomUUID(), listingId: input.listingId, campaignId: input.campaignId, userId: input.userId,
    type: input.type, amountCents: input.amountCents, currency, platformFeeCents: fee(input.amountCents),
    provider: provider(), providerCheckoutId: provider() === "test" ? `test_checkout_${input.idempotencyKey}` : null,
    reason: input.reason ?? null, receiptEmail: input.receiptEmail ?? null, idempotencyKey: input.idempotencyKey, metadata: input.metadata ?? {},
  }).onConflictDoNothing({ target: paymentsTable.idempotencyKey }).returning();
  if (made) return made;
  const [old] = await tx.select().from(paymentsTable).where(eq(paymentsTable.idempotencyKey, input.idempotencyKey)).limit(1);
  if (!old || old.listingId !== input.listingId || old.amountCents !== input.amountCents || old.type !== input.type) throw new PaymentError("Idempotency-Key was already used for a different payment request", 409);
  return old;
}
export async function createCheckout(input: CheckoutInput) { return db.transaction(tx => createInTx(tx, input)); }
export async function createPayPalCheckout(input: CheckoutInput) {
  if (!isPayPalCheckoutEnabled()) throw new PaymentError("PayPal checkout is not enabled", 503);
  if (!payPalClientId() || !payPalClientSecret() || !payPalWebhookId()) {
    throw new PaymentError(`PayPal ${payPalEnvironment() === "production" ? "live" : "sandbox"} checkout is not fully configured`, 503);
  }
  if ((input.currency ?? "USD").toUpperCase() !== "USD") throw new PaymentError("PayPal checkout currently supports USD only");
  const prepared = { ...input, currency: "USD", metadata: { ...input.metadata, provider_environment: payPalEnvironment() } };
  return { payment: await db.transaction(async tx => {
    // A deferred new-listing checkout (prepared.listingId === null) has no
    // existing listing row to lock or scope an in-flight-bid guard to --
    // its own idempotency key is the only de-duplication available, and the
    // slug/website race is instead resolved at finalize() time.
    if (prepared.type !== "OWNER_BID" || prepared.listingId === null) return createInTx(tx, prepared);
    const [old] = await tx.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.idempotencyKey, prepared.idempotencyKey)).limit(1);
    if (old) return createInTx(tx, prepared);
    const [listing] = await tx.select({ id: listingsTable.id }).from(listingsTable).where(eq(listingsTable.id, prepared.listingId)).limit(1).for("no key update");
    if (!listing) throw new PaymentError("Listing not found for owner bid checkout", 404);
    // An OWNER_BID checkout always targets a real campaign -- campaignId is
    // only ever null for a SPONSORSHIP checkout, which took the early
    // return above.
    if (prepared.campaignId === null) throw new PaymentError("An owner bid checkout requires a campaign", 400);
    const [pending] = await tx.select({ id: paymentsTable.id }).from(paymentsTable).where(and(eq(paymentsTable.listingId, prepared.listingId), eq(paymentsTable.campaignId, prepared.campaignId), eq(paymentsTable.type, "OWNER_BID"), inArray(paymentsTable.status, ["pending", "requires_reconciliation"]))).limit(1);
    if (pending) throw new PaymentError("An owner bid checkout is already pending for this campaign. Resume or complete it before submitting another bid.", 409);
    return createInTx(tx, prepared);
  }) };
}
type FetchFn = (input: string, init: RequestInit) => Promise<Response>;
let paypalFetch: FetchFn = fetch;
export function setPayPalFetchForTests(value: FetchFn | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("PayPal transport overrides are only available in test mode");
  paypalFetch = value ?? fetch;
}
function base() { return payPalEnvironment() === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"; }
// Sandbox and production are separate PayPal apps with entirely separate
// credentials, merchant accounts, and webhook IDs, so every one of these
// must select the value matching the currently active mode rather than
// sharing a single variable -- that is what lets sandbox credentials keep
// working for local development after production is switched to live.
function payPalWebhookId() { return payPalEnvironment() === "production" ? process.env.PAYPAL_WEBHOOK_ID_LIVE : process.env.PAYPAL_WEBHOOK_ID; }
function payPalClientId() { return payPalEnvironment() === "production" ? process.env.PAYPAL_CLIENT_ID_LIVE : process.env.PAYPAL_CLIENT_ID; }
function payPalClientSecret() { return payPalEnvironment() === "production" ? process.env.PAYPAL_CLIENT_SECRET_LIVE : process.env.PAYPAL_CLIENT_SECRET; }
function payPalMerchantId() { return payPalEnvironment() === "production" ? process.env.PAYPAL_MERCHANT_ID_LIVE : process.env.PAYPAL_MERCHANT_ID; }
async function request(path: string, init: RequestInit) {
  const id = payPalClientId(), secret = payPalClientSecret();
  if (!id || !secret) throw new PaymentError("PayPal client credentials are not configured", 503);
  const tokenResponse = await paypalFetch(`${base()}/v1/oauth2/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
  if (!tokenResponse.ok || !token?.access_token) throw new PaymentError("PayPal authentication failed", 502, true);
  const response = await paypalFetch(`${base()}${path}`, { ...init, headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new PaymentError("PayPal request could not be completed", 502, true);
  return data;
}
const rec = (v: unknown) => v && typeof v === "object" ? v as Record<string, unknown> : null;
const str = (...v: unknown[]) => v.find((x): x is string => typeof x === "string" && x.length > 0);
export async function createPayPalOrder(paymentId: string) {
  logger.info({ event: "PAYPAL_ORDER_CREATE_STARTED", paymentId }, "PayPal order create started");
  return db.transaction(async tx => {
    const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1).for("update");
    if (!payment || payment.provider !== "paypal" || payment.status !== "pending") throw new PaymentError("Pending PayPal payment not found", 404);
    if (payment.providerCheckoutId) return { orderId: payment.providerCheckoutId, status: "CREATED" };
    // A brand-new PayPal order must never be created for a payment whose
    // campaign has since ended — this is the single choke point every
    // create-order caller goes through, so a pending checkout resumed after
    // a weekly rollover (or with a tampered client) is always rejected here,
    // independent of anything the client claims about campaign status.
    // Once an order already exists (short-circuited above), an in-flight
    // PayPal approval is allowed to complete even if the campaign rolls over
    // seconds later.
    if (payment.campaignId) {
      const currentCampaign = await ensureCurrentCampaign();
      if (payment.campaignId !== currentCampaign.id) {
        throw new PaymentError("This campaign has ended. Start a new claim in the current campaign.", 409);
      }
    }
    // This lock serializes all local attempts. The stable request id additionally
    // makes a provider retry return the same remote order.
    const result = await request("/v2/checkout/orders", { method: "POST", headers: { "paypal-request-id": `signalrank-order:${payment.id}` }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: payment.id, custom_id: payment.id, amount: { currency_code: "USD", value: (payment.amountCents / 100).toFixed(2) } }] }) });
    const orderId = str(result.id), status = str(result.status);
    if (!orderId || !status || !["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(status)) throw new PaymentError("PayPal returned an invalid order", 502);
    const [bound] = await tx.update(paymentsTable).set({ providerCheckoutId: orderId }).where(and(eq(paymentsTable.id, payment.id), sql`${paymentsTable.providerCheckoutId} is null`)).returning();
    if (!bound?.providerCheckoutId) throw new PaymentError("PayPal order persistence could not be confirmed", 503, true);
    logger.info({ event: "PAYPAL_ORDER_CREATED", paymentId, orderId: bound.providerCheckoutId, status }, "PayPal order created");
    return { orderId: bound.providerCheckoutId, status };
  });
}
function capture(data: Record<string, unknown>) {
  // Orders/captures are created and captured using the platform's own OAuth
  // client credentials with no payee override or partner attribution, so
  // PayPal guarantees funds land in the platform's own account by
  // construction. PAYPAL_MERCHANT_ID is therefore optional, but when it is
  // configured we still cross-check the order's payee as defense-in-depth.
  const unit = rec((data.purchase_units as unknown[])?.[0]), cap = rec((rec(unit?.payments)?.captures as unknown[])?.[0]), amount = rec(cap?.amount);
  const value = typeof amount?.value === "string" ? Number(amount.value) : NaN, orderId = str(data.id), captureId = str(cap?.id), status = str(cap?.status), currency = str(amount?.currency_code)?.toUpperCase();
  const merchantId = str(rec(unit?.payee)?.merchant_id);
  if (!orderId || !captureId || !status || !currency || !Number.isFinite(value)) throw new PaymentError("PayPal returned an incomplete capture", 502);
  return { orderId, captureId, status, currency, amountCents: Math.round(value * 100), merchantId };
}
// Defense-in-depth only: PAYPAL_MERCHANT_ID is never required for checkout to
// work (see the comment above), but if the operator has configured it, a
// captured order whose payee does not match is rejected rather than trusted.
function assertMerchantId(merchantId: string | undefined) {
  const expected = payPalMerchantId();
  if (expected && merchantId && merchantId !== expected) {
    throw new PaymentError("PayPal payee does not match the configured merchant account", 409);
  }
}
export async function capturePayPalOrder(paymentId: string, orderId: string) {
  logger.info({ event: "PAYPAL_CAPTURE_STARTED", paymentId, orderId }, "PayPal capture started");
  const payment = await getPayment(paymentId);
  if (!payment || payment.provider !== "paypal" || payment.providerCheckoutId !== orderId) throw new PaymentError("PayPal order does not match the local payment", 409);
  if (payment.status === "succeeded") return payment;
  const parsed = capture(await request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", headers: { "paypal-request-id": `signalrank-capture:${payment.id}` }, body: "{}" }));
  if (parsed.orderId !== orderId || parsed.status !== "COMPLETED") throw new PaymentError("PayPal capture was not completed", 409);
  assertMerchantId(parsed.merchantId);
  logger.info({ event: "PAYPAL_CAPTURED", paymentId, orderId, captureId: parsed.captureId }, "PayPal capture completed");
  const result = await processVerifiedPaymentEvent({ provider: "paypal", eventId: `capture:${parsed.captureId}`, type: "payment_succeeded", paymentId, providerCheckoutId: orderId, providerPaymentId: parsed.captureId, amountCents: parsed.amountCents, currency: parsed.currency });
  if (!result.payment || result.payment.status !== "succeeded") throw new PaymentError("PayPal capture requires reconciliation", 409);
  return result.payment;
}
async function finalize(tx: Tx, input: EventInput) {
  const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, input.paymentId)).limit(1).for("update");
  if (!payment) return { payment: null, duplicate: false, handled: false };
  if (payment.provider !== input.provider || (input.provider === "paypal" && input.providerCheckoutId !== payment.providerCheckoutId)) throw new PaymentError("Provider order does not match the payment", 409);
  const [event] = await tx.insert(paymentEventsTable).values({ id: randomUUID(), provider: input.provider, providerEventId: input.eventId, paymentId: payment.id, type: input.type, payload: input.payload ?? {}, signatureVerified: true, processedAt: new Date() }).onConflictDoNothing({ target: [paymentEventsTable.provider, paymentEventsTable.providerEventId] }).returning();
  if (!event) return { payment, duplicate: true, handled: true };
  await tx.insert(auditEventsTable).values({ id: randomUUID(), actorId: "system:payment-provider", actorRole: "system", action: `payment.webhook.${input.type}`, targetType: "payment", targetId: payment.id, metadata: { provider: input.provider, providerEventId: input.eventId } });
  // A SPONSORSHIP payment's finalize must fully serialize against
  // lib/sponsorships.ts's purchase/cancel/expiry-sweep transactions, all of
  // which hold this same advisory lock for their entire read-then-write of
  // the sponsorship row. Without it, the scheduled sweep can read "still
  // pending" and decide to release the slot at the exact moment this
  // transaction is activating it, and write its stale decision after this
  // transaction commits -- silently cancelling a sponsorship whose payment
  // just succeeded. Acquired before either branch below touches
  // sponsorshipsTable, so whichever transaction gets here first fully
  // completes (commits or rolls back) before the other proceeds.
  if (payment.type === "SPONSORSHIP") {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(SPONSORSHIP_LOCK_KEY))})`);
  }
  // Terminal success is monotonic: late deny/cancel notifications are retained
  // for audit/idempotency but cannot undo a credited payment.
  if (payment.status === "succeeded" || payment.status === "refunded" || payment.status === "partially_refunded") {
    return { payment, duplicate: false, handled: true };
  }
  if (input.type === "payment_succeeded") {
    if (input.amountCents !== payment.amountCents || input.currency !== payment.currency) {
      const [updated] = await tx.update(paymentsTable).set({ status: "requires_reconciliation", failureMessage: "Provider amount or currency did not match checkout" }).where(eq(paymentsTable.id, payment.id)).returning();
      return { payment: updated ?? payment, duplicate: false, handled: true };
    }
    // A deferred new-listing checkout has no listing yet -- this is the
    // single, atomic point where one is created, exactly once, only for a
    // verified successful payment. A same-slug/website race against another
    // payment's finalize is resolved by the unique indexes below: the loser
    // never silently drops or duplicates, it requires manual reconciliation.
    let listingId = payment.listingId;
    if (!listingId) {
      const draft = (payment.metadata as Record<string, unknown> | null)?.pendingListing as
        | PendingListingDraft
        | undefined;
      if (!draft?.id || !draft.slug || !draft.websiteUrl) {
        logger.error({ event: "LISTING_DRAFT_MISSING", paymentId: payment.id }, "Payment succeeded with no listing draft to materialize");
        const [updated] = await tx.update(paymentsTable).set({ status: "requires_reconciliation", failureMessage: "Payment succeeded but its listing draft is missing" }).where(eq(paymentsTable.id, payment.id)).returning();
        return { payment: updated ?? payment, duplicate: false, handled: true };
      }
      const [createdListing] = await tx
        .insert(listingsTable)
        .values({
          id: draft.id,
          ownerId: draft.ownerId,
          ownerEmail: draft.ownerEmail,
          ownerName: draft.ownerName,
          managementTokenHash: draft.managementTokenHash,
          managementTokenExpiresAt: new Date(draft.managementTokenExpiresAt),
          name: draft.name,
          slug: draft.slug,
          tagline: draft.tagline,
          description: draft.description,
          category: draft.category,
          initials: draft.initials,
          accent: draft.accent,
          websiteUrl: draft.websiteUrl,
          demoVideoUrl: draft.demoVideoUrl ?? null,
          ownerBidCents: 0,
          creationPaymentId: payment.id,
        })
        // No explicit target: catches a conflict on either the slug or the
        // website unique index, whichever a racing payment's finalize won.
        .onConflictDoNothing()
        .returning();
      if (!createdListing) {
        logger.warn({ event: "LISTING_CREATION_RACE_LOST", paymentId: payment.id, slug: draft.slug, websiteUrl: draft.websiteUrl }, "Deferred listing creation lost a slug/website race at finalize");
        const [updated] = await tx.update(paymentsTable).set({ status: "requires_reconciliation", failureMessage: "This website or product slug was claimed by another completed payment" }).where(eq(paymentsTable.id, payment.id)).returning();
        return { payment: updated ?? payment, duplicate: false, handled: true };
      }
      listingId = createdListing.id;
    }
    // A sponsorship's slot was reserved (status "pending") at checkout time
    // under the sponsorship advisory lock. Checked and locked here, BEFORE
    // the payment is marked succeeded: if the scheduled expiry sweep raced
    // this verified payment and already released the reservation as stale,
    // this payment must never silently finalize as a no-op success with no
    // sponsorship to show for it -- it goes to requires_reconciliation
    // instead, same as a deferred-listing race loser above.
    let sponsorshipToActivate: { id: string; durationDays: number } | null = null;
    if (payment.type === "SPONSORSHIP") {
      const [sponsorship] = await tx.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.paymentId, payment.id)).limit(1).for("update");
      if (!sponsorship || sponsorship.status !== "pending") {
        logger.error({ event: "SPONSORSHIP_RESERVATION_LOST", paymentId: payment.id }, "Sponsorship payment succeeded but its slot reservation is missing or no longer pending");
        const [updated] = await tx.update(paymentsTable).set({ status: "requires_reconciliation", failureMessage: "Payment succeeded but its sponsorship slot reservation was already released" }).where(eq(paymentsTable.id, payment.id)).returning();
        return { payment: updated ?? payment, duplicate: false, handled: true };
      }
      sponsorshipToActivate = { id: sponsorship.id, durationDays: sponsorship.durationDays };
    }
    // Sponsorships never write to ledgerEntriesTable -- they are a fully
    // separate paid product from the weekly campaign, and campaign ranking
    // must remain computable with zero knowledge of sponsorship data.
    if (payment.type !== "SPONSORSHIP") {
      await tx.insert(ledgerEntriesTable).values({ id: randomUUID(), listingId, campaignId: payment.campaignId, userId: payment.userId, type: payment.type, amountCents: payment.amountCents, currency: payment.currency, status: input.provider === "test" ? "sandbox_verified" : "verified", provider: input.provider, providerTransactionId: input.providerPaymentId ?? payment.id, paymentId: payment.id, providerEventId: input.eventId, reason: payment.reason, idempotencyKey: `payment:${payment.id}:principal` }).onConflictDoNothing();
    }
    const number = payment.receiptNumber ?? `SR-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`;
    const [updated] = await tx.update(paymentsTable).set({ listingId, status: "succeeded", providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId, receiptNumber: number, failureCode: null, failureMessage: null }).where(eq(paymentsTable.id, payment.id)).returning();
    await tx.insert(paymentReceiptsTable).values({ id: randomUUID(), paymentId: payment.id, receiptNumber: number, email: payment.receiptEmail, amountCents: payment.amountCents, platformFeeCents: payment.platformFeeCents, currency: payment.currency }).onConflictDoNothing();
    // The single, atomic point where a *verified* payment activates its
    // sponsorship: sets its server-time start/expiry window and flips it to
    // "active" so it starts appearing publicly. Never derived from anything
    // the client sends, and never done outside this transaction.
    if (sponsorshipToActivate) {
      const startAt = new Date();
      const expiresAt = new Date(startAt.getTime() + sponsorshipToActivate.durationDays * 24 * 60 * 60 * 1000);
      await tx.update(sponsorshipsTable).set({ status: "active", startAt, expiresAt }).where(eq(sponsorshipsTable.id, sponsorshipToActivate.id));
    }
    // Invoice numbering/creation happens atomically in this same transaction
    // (see createInvoiceForFinalizedPayment) so a payment can never finalize
    // as succeeded without an invoice, and never gets a second one. PDF
    // rendering and emailing are triggered afterward, once the transaction
    // that finalized this payment has actually committed -- see the callers
    // of finalize() below, never from in here.
    await createInvoiceForFinalizedPayment(tx, updated ?? payment, listingId);
    logger.info({ event: "TRANSACTION_FINALIZED", paymentId: payment.id, provider: input.provider, type: payment.type }, "Payment finalized as succeeded");
    return { payment: updated ?? payment, duplicate: false, handled: true };
  }
  if (input.type === "payment_failed" || input.type === "payment_cancelled") {
    const [updated] = await tx.update(paymentsTable).set({ status: "failed", failureCode: input.failureCode ?? "provider_declined", failureMessage: input.failureMessage ?? "The payment provider declined the payment" }).where(eq(paymentsTable.id, payment.id)).returning();
    // Frees the slot a failed/cancelled sponsorship checkout had reserved --
    // without this, a declined PayPal order would otherwise permanently
    // occupy one of the 4 slots.
    if (payment.type === "SPONSORSHIP") {
      await tx.update(sponsorshipsTable).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(sponsorshipsTable.paymentId, payment.id), eq(sponsorshipsTable.status, "pending")));
    }
    return { payment: updated ?? payment, duplicate: false, handled: true };
  }
  return { payment, duplicate: false, handled: true };
}
export async function processVerifiedPaymentEvent(input: EventInput) {
  const result = await db.transaction(tx => finalize(tx, input));
  // Runs only after the transaction has committed -- PDF rendering, object
  // storage, and outbound email must never hold open (or roll back) the
  // payment's own transaction. Idempotent: a payment that didn't just
  // freshly succeed here either has no invoice yet (no-op) or one that was
  // already delivered (no-op), so this is safe to call on every event.
  if (result.payment?.status === "succeeded") triggerInvoiceDeliveryForPayment(result.payment.id);
  return result;
}
// Exported so a caller that already created its own payment row inside an
// owned transaction (see purchaseSponsorship in lib/sponsorships.ts) can
// synchronously complete it in test mode without re-running createInTx a
// second time. Deliberately does NOT trigger invoice delivery here: it runs
// inside a transaction it does not own, so the invoice row is not
// guaranteed visible outside it yet -- every owning caller triggers
// delivery itself after its own transaction commits.
export async function completeTestPaymentInTransaction(tx: Tx, payment: Payment): Promise<Payment> {
  if (payment.status === "succeeded") return payment;
  const result = await finalize(tx, { provider: "test", eventId: `test:${payment.id}`, type: "payment_succeeded", paymentId: payment.id, providerCheckoutId: payment.providerCheckoutId ?? undefined, providerPaymentId: `test_payment_${payment.id}`, amountCents: payment.amountCents, currency: payment.currency });
  if (!result.payment) throw new PaymentError("Test payment could not be completed", 500);
  return result.payment;
}
export async function createAndCompleteTestCheckoutInTransaction(tx: Tx, input: CheckoutInput) {
  const payment = await createInTx(tx, input);
  return completeTestPaymentInTransaction(tx, payment);
}
export async function createAndCompleteTestCheckout(input: CheckoutInput) {
  const payment = await db.transaction(tx => createAndCompleteTestCheckoutInTransaction(tx, input));
  if (payment.status === "succeeded") triggerInvoiceDeliveryForPayment(payment.id);
  return payment;
}
export async function createRefund(input: { paymentId: string; userId: string; amountCents: number; reason?: string; idempotencyKey: string }) {
  const result = await db.transaction(async tx => {
    const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, input.paymentId)).limit(1).for("update");
    if (!payment || payment.userId !== input.userId) throw new PaymentError("Payment not found", 404);
    if (payment.type === "COMMUNITY_BID") throw new PaymentError("Community bid payments are non-refundable", 409);
    if (!["succeeded", "partially_refunded"].includes(payment.status)) throw new PaymentError("Payment is not refundable", 409);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > payment.amountCents) throw new PaymentError("Invalid refund amount");
    const [replay] = await tx.select().from(refundsTable).where(eq(refundsTable.idempotencyKey, input.idempotencyKey)).limit(1);
    if (replay && (replay.paymentId !== payment.id || replay.amountCents !== input.amountCents || replay.reason !== (input.reason ?? null))) {
      throw new PaymentError("Idempotency-Key was already used for a different refund request", 409);
    }
    const reserved = await tx.select({ amountCents: refundsTable.amountCents }).from(refundsTable).where(and(
      eq(refundsTable.paymentId, payment.id),
      inArray(refundsTable.status, ["pending", "succeeded"]),
    ));
    const reservedCents = reserved.reduce((total, refund) => total + refund.amountCents, 0);
    if (!replay && input.amountCents > payment.amountCents - reservedCents) {
      throw new PaymentError("Refund amount exceeds the remaining refundable balance", 409);
    }
    const [made] = replay ? [replay] : await tx.insert(refundsTable).values({ id: randomUUID(), paymentId: payment.id, amountCents: input.amountCents, reason: input.reason ?? null, status: "pending", idempotencyKey: input.idempotencyKey }).returning();
    const refund = made;
    if (payment.provider !== "test") throw new PaymentError("Refund provider adapter is not available", 503);
    // A payment only reaches "succeeded"/"partially_refunded" (checked above)
    // after finalize() has resolved a real listing, so listingId is always
    // populated here -- this guard documents that invariant for the type
    // checker rather than expecting it to ever actually fire.
    if (!payment.listingId) throw new PaymentError("Payment is missing its listing", 500);
    if (refund.status !== "succeeded") {
      const [original] = await tx.select().from(ledgerEntriesTable).where(and(eq(ledgerEntriesTable.paymentId, payment.id), eq(ledgerEntriesTable.type, payment.type))).limit(1);
      if (!original) throw new PaymentError("Payment ledger entry was not found", 409);
      await tx.insert(ledgerEntriesTable).values({ id: randomUUID(), listingId: payment.listingId, campaignId: payment.campaignId, userId: payment.userId, type: "REFUND", amountCents: refund.amountCents, currency: payment.currency, status: "sandbox_verified", provider: "test", providerTransactionId: `test_refund_${refund.id}`, paymentId: payment.id, providerEventId: `test_refund_succeeded:${refund.id}`, refundOfLedgerEntryId: original.id, reason: refund.reason, idempotencyKey: `refund:${refund.id}:reversal` }).onConflictDoNothing();
      await tx.update(refundsTable).set({ status: "succeeded", providerRefundId: `test_refund_${refund.id}` }).where(eq(refundsTable.id, refund.id));
      const successful = await tx.select({ amountCents: refundsTable.amountCents }).from(refundsTable).where(and(
        eq(refundsTable.paymentId, payment.id),
        eq(refundsTable.status, "succeeded"),
      ));
      // The current refund has already transitioned to succeeded, so it is
      // included in this query exactly once.
      const refundedCents = successful.reduce((total, item) => total + item.amountCents, 0);
      const nextStatus = refundedCents >= payment.amountCents ? "refunded" : "partially_refunded";
      await tx.update(paymentsTable).set({ status: nextStatus }).where(eq(paymentsTable.id, payment.id));
      await tx.insert(auditEventsTable).values({ id: randomUUID(), actorId: "system:test-provider", actorRole: "system", action: "payment.webhook.refund_succeeded", targetType: "payment", targetId: payment.id, metadata: { refundId: refund.id, provider: "test" } });
      // Reflects the refund onto the existing invoice's status/refundedCents
      // -- the invoice row and its number are never regenerated; its PDF
      // and any refund-notice email are handled after commit below.
      await syncInvoiceStatusForPayment(tx, payment.id, refundedCents, nextStatus);
    }
    const [updatedPayment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id)).limit(1);
    const [updatedRefund] = await tx.select().from(refundsTable).where(eq(refundsTable.id, refund.id)).limit(1);
    return { refund: updatedRefund ?? refund, payment: updatedPayment ?? payment };
  });
  // Runs only after the refund transaction has committed, same reasoning as
  // triggerInvoiceDeliveryForPayment: PDF regeneration and outbound email
  // must never hold open (or roll back) the refund's own transaction.
  // Idempotent -- a replayed/duplicate refund call that didn't just grow
  // refundedCents is a silent no-op (see notifyInvoiceRefunded's atomic
  // claim), so this is safe to call unconditionally on every refund.
  triggerInvoiceRefundNotification(result.payment.id);
  return result;
}
export async function reconcilePayments() {
  const stale = await db.update(paymentsTable).set({ status: "requires_reconciliation", failureMessage: "Pending payment requires reconciliation" }).where(and(eq(paymentsTable.status, "pending"), lt(paymentsTable.createdAt, new Date(Date.now() - 15 * 60 * 1000)))).returning();
  return { markedForReview: stale.length, pending: 0, failed: 0, succeeded: 0 };
}
export async function getPaymentReceipt(paymentId: string) { const [row] = await db.select().from(paymentReceiptsTable).where(eq(paymentReceiptsTable.paymentId, paymentId)).limit(1); return row ?? null; }
export async function getPaymentProviderStatus() { return { mode: payPalEnvironment() === "production" && isPayPalCheckoutEnabled() ? "live" as const : "sandbox" as const, provider: provider(), liveEnabled: isLivePaymentsEnabled() && isPayPalCheckoutEnabled(), ...(provider() === "paypal" ? { paypalClientId: payPalClientId() ?? null } : {}) }; }
export async function getActiveListing(listingId: string) { const [row] = await db.select({ id: listingsTable.id, ownerId: listingsTable.ownerId }).from(listingsTable).where(and(eq(listingsTable.id, listingId), eq(listingsTable.status, "active"))).limit(1); return row ?? null; }
export function signTestWebhook(body: string | Buffer) { return `sha256=${createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET ?? "signalrank-local-test-webhook-secret").update(body).digest("hex")}`; }
export function verifyWebhookSignature(_: string, body: Buffer, signature?: string) { const expected = signTestWebhook(body); return Boolean(signature && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))); }
export function parseWebhookEvent(raw: Buffer): EventInput { const data = rec(JSON.parse(raw.toString("utf8"))); if (!data || !str(data.id) || !str(data.type) || !str(data.paymentId)) throw new PaymentError("Webhook body is invalid"); return { provider: "test", eventId: String(data.id), type: data.type as PaymentEventType, paymentId: String(data.paymentId), amountCents: typeof data.amountCents === "number" ? data.amountCents : undefined, currency: str(data.currency), payload: data }; }
// The platform subscribes to exactly these six checkout/capture events (see
// the PayPal Developer Dashboard webhook configuration). Any other event
// type reaching this handler is acknowledged as a safe no-op rather than
// rejected, so a dashboard misconfiguration can never break delivery.
const PAYPAL_WEBHOOK_EVENTS = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.DECLINED",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
]);
// Order-level events carry a full Order resource (id = order id), except
// CHECKOUT.PAYMENT-APPROVAL.REVERSED whose resource nests `order_id`
// instead. Capture-level events carry a Capture resource (id = capture id)
// with the order id under supplementary_data.related_ids.order_id.
function paypalWebhookOrderId(eventType: string, resource: Record<string, unknown> | null) {
  if (eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED") return str(resource?.order_id);
  if (eventType === "CHECKOUT.ORDER.APPROVED" || eventType === "CHECKOUT.ORDER.DECLINED") return str(resource?.id);
  return str(rec(rec(resource?.supplementary_data)?.related_ids)?.order_id);
}
export async function verifyAndProcessPayPalWebhook(raw: Buffer, headers: Record<string, string | undefined>) {
  const event = rec(JSON.parse(raw.toString("utf8"))), webhookId = payPalWebhookId();
  if (!event || !webhookId || !headers["paypal-transmission-id"] || !headers["paypal-transmission-time"] || !headers["paypal-transmission-sig"] || !headers["paypal-cert-url"] || !headers["paypal-auth-algo"]) throw new PaymentError("Invalid PayPal webhook", 401);
  const verification = await request("/v1/notifications/verify-webhook-signature", { method: "POST", body: JSON.stringify({ auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: webhookId, webhook_event: event }) });
  if (verification.verification_status !== "SUCCESS") throw new PaymentError("Invalid PayPal webhook signature", 401);
  const eventId = str(event.id), eventType = String(event.event_type);
  if (!eventId) throw new PaymentError("Malformed PayPal webhook event");
  // Every event is signature-verified above regardless of type. Only events
  // outside the subscribed whitelist stop here, safely acknowledged.
  if (!PAYPAL_WEBHOOK_EVENTS.has(eventType)) return { payment: null, duplicate: false, handled: false };
  const resource = rec(event.resource);
  const isOrderLevel = eventType !== "PAYMENT.CAPTURE.COMPLETED" && eventType !== "PAYMENT.CAPTURE.DENIED" && eventType !== "PAYMENT.CAPTURE.PENDING";
  const orderId = paypalWebhookOrderId(eventType, resource), captureId = isOrderLevel ? undefined : str(resource?.id);
  if (!orderId) throw new PaymentError("Malformed PayPal webhook event");
  const [payment] = await db.select().from(paymentsTable).where(and(eq(paymentsTable.provider, "paypal"), eq(paymentsTable.providerCheckoutId, orderId))).limit(1);
  if (!payment) throw new PaymentError("Payment referenced by webhook was not found", 404);
  if (eventType === "PAYMENT.CAPTURE.PENDING") {
    // Record-only: audits the delivery and protects against duplicates, but
    // never changes payment status or credits the ledger.
    return processVerifiedPaymentEvent({ provider: "paypal", eventId, type: "payment_pending", paymentId: payment.id, providerCheckoutId: orderId, providerPaymentId: captureId, payload: event });
  }
  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    // Record-only: the buyer approved the order, but funds are only ever
    // credited on a verified PAYMENT.CAPTURE.COMPLETED.
    return processVerifiedPaymentEvent({ provider: "paypal", eventId, type: "order_approved", paymentId: payment.id, providerCheckoutId: orderId, payload: event });
  }
  if (eventType === "PAYMENT.CAPTURE.DENIED") {
    return processVerifiedPaymentEvent({ provider: "paypal", eventId, type: "payment_failed", paymentId: payment.id, providerCheckoutId: orderId, providerPaymentId: captureId, payload: event });
  }
  if (eventType === "CHECKOUT.ORDER.DECLINED" || eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED") {
    return processVerifiedPaymentEvent({ provider: "paypal", eventId, type: "payment_cancelled", paymentId: payment.id, providerCheckoutId: orderId, payload: event });
  }
  // eventType === "PAYMENT.CAPTURE.COMPLETED": never trust the webhook body
  // for amount/currency/status -- re-fetch the order from PayPal and verify.
  if (!captureId) throw new PaymentError("Malformed PayPal capture");
  const verifiedCapture = capture(await request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" }));
  if (verifiedCapture.orderId !== orderId || verifiedCapture.captureId !== captureId || verifiedCapture.status !== "COMPLETED") {
    throw new PaymentError("PayPal webhook capture did not match its order", 409);
  }
  assertMerchantId(verifiedCapture.merchantId);
  return processVerifiedPaymentEvent({ provider: "paypal", eventId, type: "payment_succeeded", paymentId: payment.id, providerCheckoutId: orderId, providerPaymentId: captureId, amountCents: verifiedCapture.amountCents, currency: verifiedCapture.currency, payload: event });
}