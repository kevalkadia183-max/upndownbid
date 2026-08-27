import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  CreatePaymentCheckoutBody,
  CreatePaymentCheckoutHeader,
  CreatePaymentCheckoutResponse,
  GetPaymentParams,
  GetPaymentResponse,
  ReconcilePaymentsResponse,
  ReceivePaymentWebhookHeader,
  ReceivePaymentWebhookParams,
  ReceivePaymentWebhookResponse,
  RefundPaymentBody,
  RefundPaymentHeader,
  RefundPaymentParams,
  RefundPaymentResponse,
} from "@workspace/api-zod";
import type { Payment, PaymentReceipt } from "@workspace/db";
import { getRequestActor, requireActiveActor, requireModerator } from "../lib/moderation";
import {
  createAndCompleteTestCheckout,
  createCheckout,
  createPayPalCheckout,
  createPayPalOrder,
  capturePayPalOrder,
  verifyAndProcessPayPalWebhook,
  createRefund,
  getActiveListing,
  getPayment,
  getPaymentReceipt,
  isLivePaymentsEnabled,
  isPayPalCheckoutEnabled,
  parseWebhookEvent,
  PaymentError,
  processVerifiedPaymentEvent,
  reconcilePayments,
  verifyWebhookSignature,
} from "../lib/payments";
import { ensureSignalRankSeed } from "../lib/signalrank-seed";
import { ensureCurrentCampaign } from "../lib/campaigns";

const router: IRouter = Router();
const paypalPaymentBody = z.object({ paymentId: z.string().uuid() });
const paypalCaptureBody = z.object({ paymentId: z.string().uuid(), orderId: z.string().min(1).max(255) });

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function paymentResponse(payment: Payment, receipt: PaymentReceipt | null = null) {
  return {
    id: payment.id,
    listingId: payment.listingId,
    type: payment.type as "OWNER_BID" | "COMMUNITY_BID" | "PENALTY" | "SPONSORSHIP",
    amount: dollars(payment.amountCents),
    currency: payment.currency,
    platformFee: dollars(payment.platformFeeCents),
    provider: payment.provider,
    status: payment.status,
    providerCheckoutId: payment.providerCheckoutId ?? null,
    providerPaymentId: payment.providerPaymentId ?? null,
    failureCode: payment.failureCode ?? null,
    failureMessage: payment.failureMessage ?? null,
    receiptNumber: payment.receiptNumber ?? receipt?.receiptNumber ?? null,
    receiptEmail: payment.receiptEmail ?? receipt?.email ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function paymentError(res: Parameters<IRouter["use"]>[1] extends never ? never : any, error: unknown): boolean {
  if (error instanceof PaymentError) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

router.post("/payments/checkout", async (req, res): Promise<void> => {
  const [body, header] = [
    CreatePaymentCheckoutBody.safeParse(req.body),
    CreatePaymentCheckoutHeader.safeParse({
      "Idempotency-Key": req.get("Idempotency-Key"),
    }),
  ];
  if (!body.success || !header.success) {
    res.status(400).json({ error: "A valid payment request and Idempotency-Key header are required" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  const listing = await getActiveListing(body.data.listingId);
  if (!listing) {
    res.status(404).json({ error: "Active listing not found" });
    return;
  }
  if (body.data.type === "OWNER_BID" && listing.ownerId !== actor.id) {
    res.status(403).json({ error: "Only the listing owner can create an owner bid" });
    return;
  }

  try {
    if (Math.round(body.data.amount * 100) < campaign.minimumBidCents) {
      res.status(400).json({
        error: `The minimum transaction is ${dollars(campaign.minimumBidCents)} USD for the current campaign`,
      });
      return;
    }
    const input = {
      listingId: body.data.listingId,
      campaignId: campaign.id,
      userId: actor.id,
      type: body.data.type,
      amountCents: Math.round(body.data.amount * 100),
      currency: body.data.currency ?? "USD",
      reason: body.data.reason,
      // Falls back to the authenticated member's verified Clerk email so a
      // confirmed payment always has a real address to send its invoice to,
      // even when the client didn't collect one at checkout.
      receiptEmail: body.data.receiptEmail ?? actor.email ?? null,
      idempotencyKey: header.data["Idempotency-Key"],
    };
    const payPalCheckout = isPayPalCheckoutEnabled() ? await createPayPalCheckout(input) : null;
    const payment = payPalCheckout
        ? payPalCheckout.payment
      : isLivePaymentsEnabled()
        ? await createCheckout(input)
        : await createAndCompleteTestCheckout(input);
    const receipt = await getPaymentReceipt(payment.id);
    res.status(201).json(
      CreatePaymentCheckoutResponse.parse({
        ...paymentResponse(payment, receipt),
      }),
    );
  } catch (error) {
    if (!paymentError(res, error)) throw error;
  }
});

router.get("/payments/:id", async (req, res): Promise<void> => {
  const params = GetPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid payment identifier" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const payment = await getPayment(params.data.id);
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  if (payment.userId !== actor.id && !["moderator", "admin"].includes(actor.role)) {
    res.status(403).json({ error: "Payment is not owned by this member" });
    return;
  }
  const receipt = await getPaymentReceipt(payment.id);
  res.json(GetPaymentResponse.parse(paymentResponse(payment, receipt)));
});

router.post("/payments/:id/refund", async (req, res): Promise<void> => {
  const [params, body, header] = [
    RefundPaymentParams.safeParse(req.params),
    RefundPaymentBody.safeParse(req.body),
    RefundPaymentHeader.safeParse({
      "Idempotency-Key": req.get("Idempotency-Key"),
    }),
  ];
  if (!params.success || !body.success || !header.success) {
    res.status(400).json({ error: "A valid refund request and Idempotency-Key header are required" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  try {
    const { refund, payment } = await createRefund({
      paymentId: params.data.id,
      userId: actor.id,
      amountCents: Math.round(body.data.amount * 100),
      reason: body.data.reason,
      idempotencyKey: header.data["Idempotency-Key"],
    });
    const receipt = await getPaymentReceipt(payment.id);
    res.json(
      RefundPaymentResponse.parse({
        refund: {
          id: refund.id,
          paymentId: refund.paymentId,
          amount: dollars(refund.amountCents),
          reason: refund.reason ?? null,
          status: refund.status,
          providerRefundId: refund.providerRefundId ?? null,
          createdAt: refund.createdAt.toISOString(),
        },
        payment: paymentResponse(payment, receipt),
      }),
    );
  } catch (error) {
    if (!paymentError(res, error)) throw error;
  }
});

router.post("/paypal/create-order", async (req, res): Promise<void> => {
  const body = paypalPaymentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A local payment id is required" }); return; }
  try {
    const payment = await getPayment(body.data.paymentId);
    const actor = await getRequestActor(req);
    if (!payment || (payment.userId !== null && payment.userId !== actor?.id)) { res.status(404).json({ error: "Payment not found" }); return; }
    const order = await createPayPalOrder(payment.id);
    res.status(201).json({ paymentId: payment.id, orderId: order.orderId, status: order.status });
  } catch (error) { if (!paymentError(res, error)) throw error; }
});

router.post("/paypal/capture-order", async (req, res): Promise<void> => {
  const body = paypalCaptureBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Local payment and order ids are required" }); return; }
  try {
    const payment = await getPayment(body.data.paymentId);
    const actor = await getRequestActor(req);
    if (!payment || (payment.userId !== null && payment.userId !== actor?.id)) { res.status(404).json({ error: "Payment not found" }); return; }
    const captured = await capturePayPalOrder(payment.id, body.data.orderId);
    res.json(paymentResponse(captured, await getPaymentReceipt(captured.id)));
  } catch (error) { if (!paymentError(res, error)) throw error; }
});

router.post("/paypal/webhook", async (req, res): Promise<void> => {
  if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: "A raw PayPal JSON webhook is required" }); return; }
  const headers = Object.fromEntries(Object.entries(req.headers).flatMap(([key, value]) =>
    typeof value === "string" ? [[key.toLowerCase(), value]] : [],
  )) as Record<string, string | undefined>;
  try {
    const result = await verifyAndProcessPayPalWebhook(req.body, headers);
    res.status(202).json({ duplicate: result.duplicate, handled: result.handled, payment: result.payment ? paymentResponse(result.payment, await getPaymentReceipt(result.payment.id)) : null });
  } catch (error) {
    req.log.warn({ errorType: error instanceof Error ? error.name : typeof error }, "PayPal webhook rejected");
    if (!paymentError(res, error)) throw error;
  }
});

router.post("/payments/webhooks/:provider", async (req, res): Promise<void> => {
  const params = ReceivePaymentWebhookParams.safeParse(req.params);
  if (!params.success || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "A signed JSON webhook is required" });
    return;
  }
  const header = ReceivePaymentWebhookHeader.safeParse(req.headers);
  if (!header.success) {
    res.status(400).json({ error: "A signed JSON webhook is required" });
    return;
  }

  try {
    if (
      !verifyWebhookSignature(
        params.data.provider,
        req.body,
        header.data["x-payment-signature"],
      )
    ) {
      res.status(401).json({ error: "Invalid payment webhook signature" });
      return;
    }
    const event = parseWebhookEvent(req.body);
    const result = await processVerifiedPaymentEvent({ ...event, provider: params.data.provider });
    if (!result.payment) {
      res.status(404).json({ error: "Payment referenced by webhook was not found" });
      return;
    }
    const receipt = await getPaymentReceipt(result.payment.id);
    res.json(
      ReceivePaymentWebhookResponse.parse({
        eventId: event.eventId,
        duplicate: result.duplicate,
        handled: result.handled,
        payment: paymentResponse(result.payment, receipt),
      }),
    );
  } catch (error) {
    if (!paymentError(res, error)) throw error;
  }
});

router.post("/admin/payments/reconciliation", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const report = await reconcilePayments();
  req.log.info({ actorId: actor.id, ...report }, "Reconciled payment states");
  res.json(ReconcilePaymentsResponse.parse(report));
});

export default router;