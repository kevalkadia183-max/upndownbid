import { randomUUID } from "node:crypto";
import {
  db,
  invoicesTable,
  listingClicksTable,
  listingsTable,
  paymentEventsTable,
  paymentsTable,
  siteSettingsTable,
  sponsorshipEventsTable,
  sponsorshipsTable,
  usersTable,
  type Sponsorship,
} from "@workspace/db";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  completeTestPaymentInTransaction,
  createInTx,
  isLivePaymentsEnabled,
  isPayPalCheckoutEnabled,
  PaymentError,
  type CheckoutInput,
} from "./payments";
import { triggerInvoiceDeliveryForPayment } from "./invoices";
import { DEFAULT_SITE_SETTINGS } from "./policy-content";
import { logger } from "./logger";
import { SPONSORSHIP_LOCK_KEY } from "./advisory-locks";

// Featured/Sponsored Listing product. Exactly 4 rotating 7-day slots, fully
// separate from the weekly campaign ranking product -- see the module
// comment on lib/db/src/schema/sponsorships.ts for the isolation
// invariant. Slot allocation and expiration are always computed here,
// server-side, from stored timestamps and a Postgres advisory lock; nothing
// about eligibility, price, or availability is ever trusted from the
// client.
export const TOTAL_SPONSORSHIP_SLOTS = 4;
export const DEFAULT_SPONSORSHIP_PRICE_CENTS = 4900;
export const DEFAULT_SPONSORSHIP_DURATION_DAYS = 7;
// How long a "pending" sponsorship checkout (payment created, not yet
// confirmed succeeded) keeps occupying its slot, for a reservation the
// buyer never even approved on PayPal's side. Mirrors the 15-minute
// stale-pending window reconcilePayments() already uses for ordinary
// payments -- long enough for a real PayPal approval to complete, short
// enough that an abandoned checkout can't squat a slot forever.
const PENDING_RESERVATION_TTL_MS = 15 * 60 * 1000;
// Once the buyer has actually approved the PayPal order (a verified
// CHECKOUT.ORDER.APPROVED webhook recorded an "order_approved" payment
// event), the capture is expected to land within seconds -- but must never
// be raced away by the plain 15-minute TTL above just because the capture
// callback was slow or momentarily failed. An approved-but-uncaptured
// reservation instead gets this much longer backstop before the sweep
// gives up on it, and even then it is escalated for manual reconciliation
// rather than silently released, since real buyer approval happened.
const APPROVED_PENDING_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class SponsorshipError extends PaymentError {}

async function getSiteSetting(tx: Tx | typeof db, key: string): Promise<string> {
  const [row] = await tx.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return row?.value ?? DEFAULT_SITE_SETTINGS[key] ?? "";
}

export async function getSponsorshipSettings(
  tx: Tx | typeof db = db,
): Promise<{ priceCents: number; durationDays: number }> {
  const [rawPrice, rawDuration] = await Promise.all([
    getSiteSetting(tx, "sponsorshipPriceCents"),
    getSiteSetting(tx, "sponsorshipDurationDays"),
  ]);
  const priceCents = Math.round(Number(rawPrice));
  const durationDays = Math.round(Number(rawDuration));
  return {
    priceCents: Number.isFinite(priceCents) && priceCents > 0 ? priceCents : DEFAULT_SPONSORSHIP_PRICE_CENTS,
    durationDays: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : DEFAULT_SPONSORSHIP_DURATION_DAYS,
  };
}

function reservationStaleBefore(now: Date, approved: boolean): Date {
  const ttl = approved ? APPROVED_PENDING_RESERVATION_TTL_MS : PENDING_RESERVATION_TTL_MS;
  return new Date(now.getTime() - ttl);
}

// Which of the given payments has a verified PayPal "order_approved" event
// recorded -- i.e. the buyer actually completed PayPal's own approval step,
// as opposed to a checkout that was abandoned before ever reaching it.
async function approvedPaymentIds(tx: Tx, paymentIds: string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const rows = await tx
    .select({ paymentId: paymentEventsTable.paymentId })
    .from(paymentEventsTable)
    .where(and(inArray(paymentEventsTable.paymentId, paymentIds), eq(paymentEventsTable.type, "order_approved")));
  return new Set(rows.map((row) => row.paymentId).filter((id): id is string => id !== null));
}

// A sponsorship occupies a slot when it is active and not yet past its
// expiry, or pending and its reservation hasn't gone stale yet -- an
// approved-but-not-yet-captured reservation gets the longer TTL.
function occupiesSlot(row: Pick<Sponsorship, "status" | "expiresAt" | "createdAt">, now: Date, approved: boolean): boolean {
  if (row.status === "active") return !row.expiresAt || row.expiresAt.getTime() > now.getTime();
  if (row.status === "pending") return row.createdAt.getTime() > reservationStaleBefore(now, approved).getTime();
  return false;
}

async function occupyingSponsorships(tx: Tx, now: Date): Promise<Sponsorship[]> {
  const candidates = await tx
    .select()
    .from(sponsorshipsTable)
    .where(inArray(sponsorshipsTable.status, ["pending", "active"]));
  const approved = await approvedPaymentIds(tx, candidates.filter((row) => row.status === "pending").map((row) => row.paymentId));
  return candidates.filter((row) => occupiesSlot(row, now, approved.has(row.paymentId)));
}

export type SponsorshipAvailability = {
  priceCents: number;
  durationDays: number;
  totalSlots: number;
  availableSlots: number;
};

export async function getSponsorshipAvailability(now = new Date()): Promise<SponsorshipAvailability> {
  const settings = await getSponsorshipSettings();
  const occupying = await db.transaction(async (tx) => occupyingSponsorships(tx, now));
  return {
    ...settings,
    totalSlots: TOTAL_SPONSORSHIP_SLOTS,
    availableSlots: Math.max(0, TOTAL_SPONSORSHIP_SLOTS - occupying.length),
  };
}

export type SponsorshipListingSummary = {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  category: string;
  initials: string;
  accent: string;
  websiteUrl: string | null;
  demoVideoUrl: string | null;
  demoViewCount: number;
  logoUrl: string | null;
  clickAnalytics: { totalClicks: number; uniqueClicks: number };
};

const EMPTY_CLICK_ANALYTICS = { totalClicks: 0, uniqueClicks: 0 };

// Same aggregate signalrank.ts uses for the public ranking list -- unique
// visitor "Website" clicks are tracked in their own table, keyed by
// listing, independent of the sponsorship product.
async function getClickAnalyticsByListingId(
  listingIds: string[],
): Promise<Map<string, { totalClicks: number; uniqueClicks: number }>> {
  if (listingIds.length === 0) return new Map();
  const rows = await db
    .select({
      listingId: listingClicksTable.listingId,
      totalClicks: sql<string>`count(*)`,
      uniqueClicks: sql<string>`count(distinct ${listingClicksTable.visitorHash})`,
    })
    .from(listingClicksTable)
    .where(inArray(listingClicksTable.listingId, listingIds))
    .groupBy(listingClicksTable.listingId);
  return new Map(
    rows.map((row) => [
      row.listingId,
      { totalClicks: Number(row.totalClicks), uniqueClicks: Number(row.uniqueClicks) },
    ]),
  );
}

// Currently-active sponsorships joined with the display fields their
// listing needs for the Discover-page section and entry popup. Never
// includes pending/expired/cancelled rows -- those are admin-only history.
export async function listActiveSponsorships(now = new Date()): Promise<
  { id: string; slotNumber: number; startAt: Date | null; expiresAt: Date | null; listing: SponsorshipListingSummary }[]
> {
  const rows = await db
    .select({
      id: sponsorshipsTable.id,
      slotNumber: sponsorshipsTable.slotNumber,
      startAt: sponsorshipsTable.startAt,
      expiresAt: sponsorshipsTable.expiresAt,
      listingId: listingsTable.id,
      listingName: listingsTable.name,
      listingSlug: listingsTable.slug,
      listingTagline: listingsTable.tagline,
      listingCategory: listingsTable.category,
      listingInitials: listingsTable.initials,
      listingAccent: listingsTable.accent,
      listingWebsiteUrl: listingsTable.websiteUrl,
      listingDemoVideoUrl: listingsTable.demoVideoUrl,
      listingDemoViewCount: listingsTable.demoViewCount,
      listingLogoUrl: listingsTable.logoUrl,
    })
    .from(sponsorshipsTable)
    .innerJoin(listingsTable, eq(sponsorshipsTable.listingId, listingsTable.id))
    .where(eq(sponsorshipsTable.status, "active"))
    .orderBy(sponsorshipsTable.slotNumber);
  const active = rows.filter((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime());
  const clickStats = await getClickAnalyticsByListingId(active.map((row) => row.listingId));
  return active.map((row) => ({
    id: row.id,
    slotNumber: row.slotNumber,
    startAt: row.startAt,
    expiresAt: row.expiresAt,
    listing: {
      id: row.listingId,
      name: row.listingName,
      slug: row.listingSlug,
      tagline: row.listingTagline,
      category: row.listingCategory,
      initials: row.listingInitials,
      accent: row.listingAccent,
      websiteUrl: row.listingWebsiteUrl,
      demoVideoUrl: row.listingDemoVideoUrl,
      demoViewCount: row.listingDemoViewCount,
      logoUrl: row.listingLogoUrl,
      clickAnalytics: clickStats.get(row.listingId) ?? EMPTY_CLICK_ANALYTICS,
    },
  }));
}

// Purchases a Featured/Sponsored slot for `listingId`, owned by `ownerId`.
// Validates availability and reserves the lowest free slot number, creates
// the payment row, and (in sandbox/test mode) synchronously completes it --
// all inside one advisory-locked transaction, so a concurrent purchase
// attempt can never be granted a 5th slot. For a live PayPal checkout the
// payment is left pending; the client completes it via the existing
// generic /paypal/create-order and /paypal/capture-order endpoints exactly
// like any other payment, and finalize() activates the sponsorship once
// PayPal confirms the capture.
export async function purchaseSponsorship(input: {
  listingId: string;
  ownerId: string;
  receiptEmail: string | null;
  idempotencyKey: string;
}): Promise<{ sponsorship: Sponsorship; sandbox: boolean }> {
  const result = await purchaseSponsorshipInTx(input);
  // Mirrors createAndCompleteTestCheckout: invoice delivery only runs once
  // the owning transaction has actually committed, never from inside it.
  if (result.sandbox) triggerInvoiceDeliveryForPayment(result.sponsorship.paymentId);
  return result;
}

async function purchaseSponsorshipInTx(input: {
  listingId: string;
  ownerId: string;
  receiptEmail: string | null;
  idempotencyKey: string;
}): Promise<{ sponsorship: Sponsorship; sandbox: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(SPONSORSHIP_LOCK_KEY))})`);
    const now = new Date();

    const [existingPaymentByKey] = await tx
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(eq(paymentsTable.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existingPaymentByKey) {
      const [existingSponsorship] = await tx
        .select()
        .from(sponsorshipsTable)
        .where(eq(sponsorshipsTable.paymentId, existingPaymentByKey.id))
        .limit(1);
      if (existingSponsorship) {
        return { sponsorship: existingSponsorship, sandbox: !isPayPalCheckoutEnabled() };
      }
    }

    const [listing] = await tx.select().from(listingsTable).where(eq(listingsTable.id, input.listingId)).limit(1).for("no key update");
    if (!listing) throw new SponsorshipError("Listing not found", 404);
    if (listing.ownerId !== input.ownerId) throw new SponsorshipError("Only the listing owner can sponsor this listing", 403);
    if (listing.status !== "active") throw new SponsorshipError("Only an active listing can be sponsored", 409);

    const occupying = await occupyingSponsorships(tx, now);
    if (occupying.some((row) => row.listingId === input.listingId)) {
      throw new SponsorshipError("This listing already has a sponsorship pending or active", 409);
    }
    if (occupying.length >= TOTAL_SPONSORSHIP_SLOTS) {
      throw new SponsorshipError("All Featured slots are currently taken. Try again once one frees up.", 409);
    }
    const takenSlots = new Set(occupying.map((row) => row.slotNumber));
    let slotNumber = 1;
    while (takenSlots.has(slotNumber) && slotNumber <= TOTAL_SPONSORSHIP_SLOTS) slotNumber += 1;
    if (slotNumber > TOTAL_SPONSORSHIP_SLOTS) throw new SponsorshipError("All Featured slots are currently taken. Try again once one frees up.", 409);

    const { priceCents, durationDays } = await getSponsorshipSettings(tx);
    const checkoutInput: CheckoutInput = {
      listingId: input.listingId,
      campaignId: null,
      userId: input.ownerId,
      type: "SPONSORSHIP",
      amountCents: priceCents,
      currency: "USD",
      reason: `Featured sponsorship — slot ${slotNumber}`,
      receiptEmail: input.receiptEmail,
      idempotencyKey: input.idempotencyKey,
      metadata: { sponsorshipSlotNumber: slotNumber },
    };
    const payment = await createInTx(tx, checkoutInput);

    const [sponsorship] = await tx
      .insert(sponsorshipsTable)
      .values({
        id: randomUUID(),
        listingId: input.listingId,
        ownerId: input.ownerId,
        slotNumber,
        status: "pending",
        priceCents,
        durationDays,
        paymentId: payment.id,
      })
      .onConflictDoNothing({ target: sponsorshipsTable.paymentId })
      .returning();
    const sponsorshipRow = sponsorship ??
      (await tx.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.paymentId, payment.id)).limit(1))[0];
    if (!sponsorshipRow) throw new SponsorshipError("Sponsorship could not be created", 500);

    if (isPayPalCheckoutEnabled()) {
      return { sponsorship: sponsorshipRow, sandbox: false };
    }
    // Sandbox/test mode completes synchronously, exactly like other
    // sandbox checkouts elsewhere in this codebase -- finalize() (called by
    // completeTestPaymentInTransaction) activates the sponsorship in the
    // same transaction.
    await completeTestPaymentInTransaction(tx, payment);
    const [activated] = await tx.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, sponsorshipRow.id)).limit(1);
    return { sponsorship: activated ?? sponsorshipRow, sandbox: true };
  });
}

export async function getSponsorshipPayment(sponsorshipId: string) {
  const sponsorship = await getSponsorshipById(sponsorshipId);
  if (!sponsorship) return null;
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, sponsorship.paymentId)).limit(1);
  return payment ?? null;
}

export async function getSponsorshipById(id: string): Promise<Sponsorship | null> {
  const [row] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, id)).limit(1);
  return row ?? null;
}

export async function getListingSummary(listingId: string): Promise<SponsorshipListingSummary | null> {
  const [row] = await db
    .select({
      id: listingsTable.id,
      name: listingsTable.name,
      slug: listingsTable.slug,
      tagline: listingsTable.tagline,
      category: listingsTable.category,
      initials: listingsTable.initials,
      accent: listingsTable.accent,
      websiteUrl: listingsTable.websiteUrl,
      demoVideoUrl: listingsTable.demoVideoUrl,
      demoViewCount: listingsTable.demoViewCount,
      logoUrl: listingsTable.logoUrl,
    })
    .from(listingsTable)
    .where(eq(listingsTable.id, listingId))
    .limit(1);
  if (!row) return null;
  const clickStats = await getClickAnalyticsByListingId([row.id]);
  return { ...row, clickAnalytics: clickStats.get(row.id) ?? EMPTY_CLICK_ANALYTICS };
}

// Owner (of the sponsored listing) or admin cancellation of an active or
// still-pending sponsorship. Frees the slot immediately. No refund is
// issued -- the spec only requires cancellation, not a refund path, and
// unlike a declined/failed payment this is a successfully paid, voluntarily
// ended sponsorship; its payment/invoice history is untouched.
export async function cancelSponsorship(
  id: string,
  actor: { id: string; role: string },
): Promise<Sponsorship> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(SPONSORSHIP_LOCK_KEY))})`);
    const [sponsorship] = await tx.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, id)).limit(1).for("update");
    if (!sponsorship) throw new SponsorshipError("Sponsorship not found", 404);
    const isOwner = sponsorship.ownerId === actor.id;
    const isAdmin = actor.role === "admin";
    if (!isOwner && !isAdmin) throw new SponsorshipError("Not authorized to cancel this sponsorship", 403);
    if (sponsorship.status !== "active" && sponsorship.status !== "pending") {
      throw new SponsorshipError("This sponsorship is not active", 409);
    }
    // Guards the WHERE clause with the status it was just verified under,
    // as defense in depth alongside the advisory lock above: this update
    // can never silently overwrite a row some other transaction has since
    // moved on from (e.g. activated).
    const [updated] = await tx
      .update(sponsorshipsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledById: actor.id })
      .where(and(eq(sponsorshipsTable.id, id), eq(sponsorshipsTable.status, sponsorship.status)))
      .returning();
    return updated ?? sponsorship;
  });
}

// Scheduled sweep (mirrors runCampaignScheduler in lib/campaigns.ts):
// flips sponsorships whose server-time expiry has passed from "active" to
// "expired", freeing their slot, and releases stale pending reservations
// (an abandoned checkout that never completed within the reservation
// window) to "cancelled". Historical rows are never deleted. Holds
// SPONSORSHIP_LOCK_KEY for its entire read-then-write, the same lock
// payment finalize() takes before activating a SPONSORSHIP payment (see
// lib/payments.ts) -- so the two can never interleave and race.
export async function sweepExpiredSponsorships(
  now = new Date(),
): Promise<{ expired: number; releasedStalePending: number; escalatedApprovedPending: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(SPONSORSHIP_LOCK_KEY))})`);
    const expiredRows = await tx
      .update(sponsorshipsTable)
      .set({ status: "expired" })
      .where(and(eq(sponsorshipsTable.status, "active"), lt(sponsorshipsTable.expiresAt, now)))
      .returning({ id: sponsorshipsTable.id });

    // Candidates under the *shorter* ("never approved") TTL only -- each is
    // individually re-checked below against its real payment/approval
    // status before anything is touched, so nothing here is released
    // purely for appearing in this list.
    const staleCandidates = await tx
      .select({ id: sponsorshipsTable.id, paymentId: sponsorshipsTable.paymentId, createdAt: sponsorshipsTable.createdAt })
      .from(sponsorshipsTable)
      .where(and(eq(sponsorshipsTable.status, "pending"), lt(sponsorshipsTable.createdAt, reservationStaleBefore(now, false))));

    const approved = await approvedPaymentIds(tx, staleCandidates.map((row) => row.paymentId));

    let releasedStalePending = 0;
    let escalatedApprovedPending = 0;
    for (const row of staleCandidates) {
      const [payment] = await tx.select({ status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.id, row.paymentId)).limit(1);
      // A payment that already succeeded (a very late webhook racing this
      // sweep) must not have its reservation pulled out from under it --
      // finalize()'s own lock+check ordering (see lib/payments.ts) protects
      // against the same race the other direction, so this is only ever
      // reached for a genuinely still-pending payment.
      if (payment?.status === "succeeded") continue;

      if (approved.has(row.paymentId)) {
        // The buyer already approved the PayPal order. Give it the much
        // longer backstop window, and even then escalate for manual
        // reconciliation instead of a plain silent release -- a real
        // approval happened, so this must never be indistinguishable from
        // an ordinary abandoned checkout.
        if (row.createdAt.getTime() >= reservationStaleBefore(now, true).getTime()) continue;
        const [releasedRow] = await tx
          .update(sponsorshipsTable)
          .set({ status: "cancelled", cancelledAt: now })
          .where(and(eq(sponsorshipsTable.id, row.id), eq(sponsorshipsTable.status, "pending")))
          .returning({ id: sponsorshipsTable.id });
        if (!releasedRow) continue;
        await tx
          .update(paymentsTable)
          .set({ status: "requires_reconciliation", failureMessage: "PayPal order was approved but never captured within the reservation window" })
          .where(and(eq(paymentsTable.id, row.paymentId), eq(paymentsTable.status, "pending")));
        escalatedApprovedPending += 1;
        continue;
      }

      const [releasedRow] = await tx
        .update(sponsorshipsTable)
        .set({ status: "cancelled", cancelledAt: now })
        .where(and(eq(sponsorshipsTable.id, row.id), eq(sponsorshipsTable.status, "pending")))
        .returning({ id: sponsorshipsTable.id });
      if (releasedRow) releasedStalePending += 1;
    }
    return { expired: expiredRows.length, releasedStalePending, escalatedApprovedPending };
  });
}

export async function runSponsorshipScheduler(): Promise<void> {
  const result = await sweepExpiredSponsorships();
  if (result.expired > 0 || result.releasedStalePending > 0 || result.escalatedApprovedPending > 0) {
    logger.info({ event: "SPONSORSHIP_SWEEP", ...result }, "Sponsorship slots swept");
  }
  if (result.escalatedApprovedPending > 0) {
    logger.warn(
      { event: "SPONSORSHIP_APPROVED_CAPTURE_MISSING", count: result.escalatedApprovedPending },
      "A sponsorship's PayPal order was approved but never captured in time; its payment now requires manual reconciliation",
    );
  }
}

export type SponsorshipEventType = "popup_impression" | "section_impression" | "click";

export async function recordSponsorshipEvent(sponsorshipId: string, type: SponsorshipEventType, visitorHash: string): Promise<void> {
  const sponsorship = await getSponsorshipById(sponsorshipId);
  if (!sponsorship) throw new SponsorshipError("Sponsorship not found", 404);
  await db.insert(sponsorshipEventsTable).values({ id: randomUUID(), sponsorshipId, type, visitorHash });
}

export type SponsorshipAdminRow = {
  sponsorship: Sponsorship;
  listing: SponsorshipListingSummary;
  ownerName: string | null;
  invoiceId: string | null;
  analytics: { popupImpressions: number; sectionImpressions: number; clicks: number; ctr: number };
  revenueCents: number;
};

// Full admin view of all 4 slots' history: every sponsorship row ever
// created (not just currently-occupying ones), each joined with its
// listing, owner display name, invoice id, and aggregated analytics/
// revenue -- an expired or cancelled sponsorship's history remains fully
// visible here, only the public active-sponsors list excludes it.
export async function listSponsorshipsForAdmin(): Promise<SponsorshipAdminRow[]> {
  const rows = await db
    .select({
      sponsorship: sponsorshipsTable,
      listingId: listingsTable.id,
      listingName: listingsTable.name,
      listingSlug: listingsTable.slug,
      listingTagline: listingsTable.tagline,
      listingCategory: listingsTable.category,
      listingInitials: listingsTable.initials,
      listingAccent: listingsTable.accent,
      listingWebsiteUrl: listingsTable.websiteUrl,
      listingDemoVideoUrl: listingsTable.demoVideoUrl,
      listingDemoViewCount: listingsTable.demoViewCount,
      listingLogoUrl: listingsTable.logoUrl,
      ownerName: usersTable.displayName,
      invoiceId: invoicesTable.id,
    })
    .from(sponsorshipsTable)
    .innerJoin(listingsTable, eq(sponsorshipsTable.listingId, listingsTable.id))
    .leftJoin(usersTable, eq(sponsorshipsTable.ownerId, usersTable.id))
    .leftJoin(invoicesTable, eq(invoicesTable.paymentId, sponsorshipsTable.paymentId))
    .orderBy(desc(sponsorshipsTable.createdAt));
  if (rows.length === 0) return [];

  const sponsorshipIds = rows.map((row) => row.sponsorship.id);
  const eventCounts = await db
    .select({ sponsorshipId: sponsorshipEventsTable.sponsorshipId, type: sponsorshipEventsTable.type, count: sql<number>`count(*)::int` })
    .from(sponsorshipEventsTable)
    .where(inArray(sponsorshipEventsTable.sponsorshipId, sponsorshipIds))
    .groupBy(sponsorshipEventsTable.sponsorshipId, sponsorshipEventsTable.type);
  const countsById = new Map<string, { popupImpressions: number; sectionImpressions: number; clicks: number }>();
  for (const row of eventCounts) {
    const current = countsById.get(row.sponsorshipId) ?? { popupImpressions: 0, sectionImpressions: 0, clicks: 0 };
    if (row.type === "popup_impression") current.popupImpressions = row.count;
    if (row.type === "section_impression") current.sectionImpressions = row.count;
    if (row.type === "click") current.clicks = row.count;
    countsById.set(row.sponsorshipId, current);
  }

  const clickStats = await getClickAnalyticsByListingId(rows.map((row) => row.listingId));
  return rows.map((row) => {
    const counts = countsById.get(row.sponsorship.id) ?? { popupImpressions: 0, sectionImpressions: 0, clicks: 0 };
    const impressions = counts.popupImpressions + counts.sectionImpressions;
    const ctr = impressions > 0 ? counts.clicks / impressions : 0;
    return {
      sponsorship: row.sponsorship,
      listing: {
        id: row.listingId,
        name: row.listingName,
        slug: row.listingSlug,
        tagline: row.listingTagline,
        category: row.listingCategory,
        initials: row.listingInitials,
        accent: row.listingAccent,
        websiteUrl: row.listingWebsiteUrl,
        demoVideoUrl: row.listingDemoVideoUrl,
        demoViewCount: row.listingDemoViewCount,
        logoUrl: row.listingLogoUrl,
        clickAnalytics: clickStats.get(row.listingId) ?? EMPTY_CLICK_ANALYTICS,
      },
      ownerName: row.ownerName ?? null,
      invoiceId: row.invoiceId ?? null,
      analytics: { ...counts, ctr },
      // An invoice only ever exists once its payment has verifiably
      // succeeded (see createInvoiceForFinalizedPayment) -- so this is
      // "was this slot actually paid for", independent of its current
      // status. Sponsorships are non-refundable on cancellation, so a
      // cancelled-after-active slot still counts its revenue.
      revenueCents: row.invoiceId ? row.sponsorship.priceCents : 0,
    };
  });
}
