import { randomUUID, createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  GetActiveSponsorshipsResponse,
  GetSponsorshipAvailabilityResponse,
  RecordSponsorshipEventBody,
  CreateSponsorshipCheckoutHeader,
  CreateSponsorshipCheckoutBody,
  CreateSponsorshipCheckoutResponse,
  CancelSponsorshipParams,
  CancelSponsorshipResponse,
  GetAdminSponsorshipsResponse,
} from "@workspace/api-zod";
import type { Payment, Sponsorship } from "@workspace/db";
import { requireActiveActor, requireAdmin } from "../lib/moderation";
import {
  cancelSponsorship,
  getListingSummary,
  getSponsorshipAvailability,
  listActiveSponsorships,
  listSponsorshipsForAdmin,
  purchaseSponsorship,
  recordSponsorshipEvent,
  SponsorshipError,
  type SponsorshipAdminRow,
  type SponsorshipListingSummary,
} from "../lib/sponsorships";
import { getPayment, getPaymentReceipt } from "../lib/payments";
import { ensureSignalRankSeed } from "../lib/signalrank-seed";

const router: IRouter = Router();

function sponsorshipError(res: Parameters<IRouter["use"]>[1] extends never ? never : any, error: unknown): boolean {
  if (error instanceof SponsorshipError) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function listingResponse(listing: SponsorshipListingSummary) {
  return {
    id: listing.id,
    name: listing.name,
    slug: listing.slug,
    tagline: listing.tagline,
    category: listing.category,
    initials: listing.initials,
    accent: listing.accent,
    websiteUrl: listing.websiteUrl ?? null,
    demoVideoUrl: listing.demoVideoUrl ?? null,
    demoViewCount: listing.demoViewCount,
    logoUrl: listing.logoUrl ?? null,
    clickAnalytics: listing.clickAnalytics,
  };
}

function activeSponsorshipResponse(row: {
  id: string;
  slotNumber: number;
  startAt: Date | null;
  expiresAt: Date | null;
  listing: SponsorshipListingSummary;
}) {
  return {
    id: row.id,
    listing: listingResponse(row.listing),
    slotNumber: row.slotNumber,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

function adminSponsorshipResponse(row: SponsorshipAdminRow) {
  return {
    id: row.sponsorship.id,
    listing: listingResponse(row.listing),
    ownerId: row.sponsorship.ownerId,
    ownerName: row.ownerName,
    slotNumber: row.sponsorship.slotNumber,
    status: row.sponsorship.status as "pending" | "active" | "expired" | "cancelled",
    price: dollars(row.sponsorship.priceCents),
    durationDays: row.sponsorship.durationDays,
    paymentId: row.sponsorship.paymentId,
    invoiceId: row.invoiceId,
    startAt: row.sponsorship.startAt ? row.sponsorship.startAt.toISOString() : null,
    expiresAt: row.sponsorship.expiresAt ? row.sponsorship.expiresAt.toISOString() : null,
    cancelledAt: row.sponsorship.cancelledAt ? row.sponsorship.cancelledAt.toISOString() : null,
    createdAt: row.sponsorship.createdAt.toISOString(),
    analytics: row.analytics,
    revenue: dollars(row.revenueCents),
  };
}

async function sponsorshipToAdminResponse(sponsorship: Sponsorship) {
  const rows = await listSponsorshipsForAdmin();
  const row = rows.find((candidate) => candidate.sponsorship.id === sponsorship.id);
  if (!row) throw new SponsorshipError("Sponsorship not found", 404);
  return adminSponsorshipResponse(row);
}

function paymentResponse(payment: Payment, receiptNumber: string | null, receiptEmail: string | null) {
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
    receiptNumber: payment.receiptNumber ?? receiptNumber,
    receiptEmail: payment.receiptEmail ?? receiptEmail,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

// Public: currently active sponsors only, for the Discover-page section and
// entry popup. Never includes pending/expired/cancelled rows.
router.get("/sponsorships/active", async (_req, res): Promise<void> => {
  const active = await listActiveSponsorships();
  res.json(
    GetActiveSponsorshipsResponse.parse({
      sponsorships: active.map(activeSponsorshipResponse),
      totalSlots: 4,
    }),
  );
});

// Public: admin-configured price/duration plus how many of the 4 slots are
// currently free, for the "Get Featured" purchase entry point.
router.get("/sponsorships/availability", async (_req, res): Promise<void> => {
  const availability = await getSponsorshipAvailability();
  res.json(
    GetSponsorshipAvailabilityResponse.parse({
      price: dollars(availability.priceCents),
      durationDays: availability.durationDays,
      totalSlots: availability.totalSlots,
      availableSlots: availability.availableSlots,
    }),
  );
});

// Public: popup/section impression or click tracking. Visitor identity is
// hashed, never stored raw, mirroring the existing listing-click/spotlight
// analytics pattern.
router.post("/sponsorships/events", async (req, res): Promise<void> => {
  const body = RecordSponsorshipEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A valid sponsorship id and event type are required" });
    return;
  }
  const visitorId = typeof req.body?.visitorId === "string" ? req.body.visitorId : req.ip ?? "unknown";
  const visitorHash = createHash("sha256").update(visitorId).digest("hex");
  try {
    await recordSponsorshipEvent(body.data.sponsorshipId, body.data.type, visitorHash);
    res.status(202).end();
  } catch (error) {
    if (!sponsorshipError(res, error)) throw error;
  }
});

// Authenticated: purchase a Featured/Sponsored slot for a listing the
// signed-in member owns. Slot allocation, price, and duration are always
// server-computed -- never trusted from the client.
router.post("/sponsorships/checkout", async (req, res): Promise<void> => {
  const [body, header] = [
    CreateSponsorshipCheckoutBody.safeParse(req.body),
    CreateSponsorshipCheckoutHeader.safeParse({ "Idempotency-Key": req.get("Idempotency-Key") }),
  ];
  if (!body.success || !header.success) {
    res.status(400).json({ error: "A valid sponsorship checkout request and Idempotency-Key header are required" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  await ensureSignalRankSeed();
  try {
    const { sponsorship, sandbox } = await purchaseSponsorship({
      listingId: body.data.listingId,
      ownerId: actor.id,
      receiptEmail: actor.email ?? null,
      idempotencyKey: header.data["Idempotency-Key"],
    });
    const [paymentRow, receipt, listing] = await Promise.all([
      getPayment(sponsorship.paymentId),
      getPaymentReceipt(sponsorship.paymentId),
      getListingSummary(sponsorship.listingId),
    ]);
    if (!paymentRow) throw new SponsorshipError("Sponsorship payment could not be found", 500);
    if (!listing) throw new SponsorshipError("Sponsored listing could not be found", 500);
    res.status(201).json(
      CreateSponsorshipCheckoutResponse.parse({
        payment: paymentResponse(paymentRow, receipt?.receiptNumber ?? null, receipt?.email ?? null),
        sponsorship: {
          id: sponsorship.id,
          listing: listingResponse(listing),
          slotNumber: sponsorship.slotNumber,
          startAt: sponsorship.startAt ? sponsorship.startAt.toISOString() : null,
          expiresAt: sponsorship.expiresAt ? sponsorship.expiresAt.toISOString() : null,
        },
        sandbox,
      }),
    );
  } catch (error) {
    if (!sponsorshipError(res, error)) throw error;
  }
});

// Authenticated: the listing owner (or an admin) can cancel their own
// active/pending sponsorship, freeing its slot immediately.
router.post("/sponsorships/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelSponsorshipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid sponsorship id is required" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  try {
    const cancelled = await cancelSponsorship(params.data.id, actor);
    res.json(CancelSponsorshipResponse.parse(await sponsorshipToAdminResponse(cancelled)));
  } catch (error) {
    if (!sponsorshipError(res, error)) throw error;
  }
});

// Admin: all 4 slots' full history (business/payment/invoice/status/dates/
// analytics/revenue) -- an expired or cancelled sponsorship remains fully
// visible here.
router.get("/admin/sponsorships", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const rows = await listSponsorshipsForAdmin();
  res.json(GetAdminSponsorshipsResponse.parse(rows.map(adminSponsorshipResponse)));
});

export default router;
