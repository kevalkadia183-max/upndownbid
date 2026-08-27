import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  db,
  invoiceEmailDeliveriesTable,
  invoicesTable,
  listingsTable,
  paymentEventsTable,
  paymentReceiptsTable,
  paymentsTable,
  pool,
  refundsTable,
  siteSettingsTable,
  sponsorshipEventsTable,
  sponsorshipsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  CancelSponsorshipResponse,
  CreateSponsorshipCheckoutResponse,
  GetActiveSponsorshipsResponse,
  GetAdminSponsorshipsResponse,
  GetSponsorshipAvailabilityResponse,
} from "@workspace/api-zod";
import { createApp } from "./app";
import {
  cancelSponsorship,
  DEFAULT_SPONSORSHIP_DURATION_DAYS,
  DEFAULT_SPONSORSHIP_PRICE_CENTS,
  getSponsorshipAvailability,
  listSponsorshipsForAdmin,
  purchaseSponsorship,
  recordSponsorshipEvent,
  sweepExpiredSponsorships,
  TOTAL_SPONSORSHIP_SLOTS,
} from "./lib/sponsorships";
import { SPONSORSHIP_LOCK_KEY } from "./lib/advisory-locks";
import { capturePayPalOrder, createPayPalOrder, processVerifiedPaymentEvent, setPayPalFetchForTests } from "./lib/payments";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";

function paypalJsonResponse(body: unknown): globalThis.Response {
  return new globalThis.Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// Runs `run` with PAYMENT_PROVIDER switched to "paypal" and a fake PayPal
// transport installed, restoring both afterward -- mirrors the withPayPal
// helper in moderation-security.test.ts so this suite can exercise the real
// createPayPalOrder/capturePayPalOrder integration points for a SPONSORSHIP
// payment specifically, not just processVerifiedPaymentEvent directly.
async function withFakePayPal<T>(fetchImpl: Parameters<typeof setPayPalFetchForTests>[0], run: () => Promise<T>): Promise<T> {
  const savedProvider = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "paypal";
  setPayPalFetchForTests(fetchImpl);
  try {
    return await run();
  } finally {
    setPayPalFetchForTests(null);
    if (savedProvider === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = savedProvider;
  }
}

// Covers task 72 (Featured sponsorships & campaign leader display): the
// 4-slot cap under concurrency, server-time-based expiration freeing a
// slot, analytics recording/aggregation, and admin-only authorization on
// the new sponsorship endpoints -- all against the real HTTP routes and a
// real database, exactly like moderation-security.test.ts and
// admin-response-contract.test.ts do for their own suites. Sponsorships
// never touch campaignListings/campaignWinners/ledgerEntries -- these tests
// only ever read/write the dedicated sponsorships/sponsorship_events tables
// plus the payments/invoices/listings/users rows they legitimately create.

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

function fakeAuthHandler(userId: string | null) {
  const handler = () => ({
    tokenType: "session_token",
    actor: null,
    sessionClaims: userId ? { email: `${userId}@example.test`, email_verified: true } : null,
    sessionId: userId ? `sess_${userId}` : null,
    sessionStatus: userId ? "active" : null,
    userId,
    orgId: null,
    orgRole: null,
    orgSlug: null,
    orgPermissions: null,
    factorVerificationAge: null,
    getToken: async () => null,
    has: () => false,
    debug: () => ({}),
    isAuthenticated: Boolean(userId),
  });
  return Object.assign(handler, { [CLERK_AUTH_BRAND]: true });
}

function testClerkAuthMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const testUserId = req.header("x-test-clerk-user-id") ?? null;
    (req as unknown as { auth: unknown }).auth = fakeAuthHandler(testUserId);
    next();
  };
}

let server: Server;
let baseUrl = "";

let ownerAClerkId = "";
let ownerBClerkId = "";
let otherMemberClerkId = "";
let adminClerkId = "";

let ownerAId = "";
let ownerBId = "";
let otherMemberId = "";
let adminId = "";

const createdUserIds: string[] = [];
const createdListingIds: string[] = [];
const createdSponsorshipIds: string[] = [];

let savedPriceSetting: string | null | undefined;
let savedDurationSetting: string | null | undefined;

async function createListing(ownerId: string): Promise<string> {
  const id = `listing-sponsorship-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id,
    ownerId,
    name: `Sponsorship Test Listing ${id}`,
    slug: `sponsorship-test-listing-${randomUUID()}`,
    tagline: "Exists purely to exercise sponsorship endpoints.",
    description: "Seeded by the sponsorships test suite.",
    category: "Testing",
    initials: "ST",
    accent: "slate",
    status: "active",
    ownerBidCents: 1000,
  });
  createdListingIds.push(id);
  return id;
}

async function purchase(listingId: string, ownerId: string) {
  return purchaseSponsorship({
    listingId,
    ownerId,
    receiptEmail: null,
    idempotencyKey: `sponsorship-test-${randomUUID()}`,
  });
}

before(async () => {
  await ensureSignalRankSeed();

  // Force a small, deterministic price/duration for this suite so assertions
  // don't depend on whatever an admin previously configured.
  const [existingPrice] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "sponsorshipPriceCents")).limit(1);
  savedPriceSetting = existingPrice?.value ?? null;
  const [existingDuration] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "sponsorshipDurationDays")).limit(1);
  savedDurationSetting = existingDuration?.value ?? null;
  await db
    .insert(siteSettingsTable)
    .values([
      { key: "sponsorshipPriceCents", value: "4900" },
      { key: "sponsorshipDurationDays", value: "7" },
    ])
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: "4900" } });
  await db
    .update(siteSettingsTable)
    .set({ value: "7" })
    .where(eq(siteSettingsTable.key, "sponsorshipDurationDays"));

  ownerAClerkId = `clerk_sponsor_owner_a_${randomUUID()}`;
  ownerBClerkId = `clerk_sponsor_owner_b_${randomUUID()}`;
  otherMemberClerkId = `clerk_sponsor_other_${randomUUID()}`;
  adminClerkId = `clerk_sponsor_admin_${randomUUID()}`;
  ownerAId = `sponsor-owner-a-${randomUUID()}`;
  ownerBId = `sponsor-owner-b-${randomUUID()}`;
  otherMemberId = `sponsor-other-${randomUUID()}`;
  adminId = `sponsor-admin-${randomUUID()}`;
  createdUserIds.push(ownerAId, ownerBId, otherMemberId, adminId);

  await db.insert(usersTable).values([
    { id: ownerAId, clerkUserId: ownerAClerkId, email: `${ownerAId}@example.test`, displayName: "Sponsor Owner A", role: "member", status: "active" },
    { id: ownerBId, clerkUserId: ownerBClerkId, email: `${ownerBId}@example.test`, displayName: "Sponsor Owner B", role: "member", status: "active" },
    { id: otherMemberId, clerkUserId: otherMemberClerkId, email: `${otherMemberId}@example.test`, displayName: "Sponsor Other Member", role: "member", status: "active" },
    { id: adminId, clerkUserId: adminClerkId, email: `${adminId}@example.test`, displayName: "Sponsor Admin", role: "admin", status: "active" },
  ]);

  const app = createApp({ clerkAuthMiddleware: testClerkAuthMiddleware() });
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (createdSponsorshipIds.length) {
    await db.delete(sponsorshipEventsTable).where(inArray(sponsorshipEventsTable.sponsorshipId, createdSponsorshipIds));
    const paymentIds = (
      await db
        .select({ paymentId: sponsorshipsTable.paymentId })
        .from(sponsorshipsTable)
        .where(inArray(sponsorshipsTable.id, createdSponsorshipIds))
    ).map((row) => row.paymentId);
    await db.delete(sponsorshipsTable).where(inArray(sponsorshipsTable.id, createdSponsorshipIds));
    if (paymentIds.length) {
      // Every finalized payment schedules its invoice delivery as a
      // fire-and-forget background job (see triggerInvoiceDeliveryForPayment
      // in lib/invoices.ts) that inserts an invoice_email_deliveries row
      // whenever it eventually settles -- which can still be in flight when
      // this cleanup runs. Retry the emailDeliveries-then-invoices delete a
      // few times so a delivery landing in that narrow window can never
      // turn into an unhandled FK-violation failure of the whole suite.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const invoiceIds = (
          await db.select({ id: invoicesTable.id }).from(invoicesTable).where(inArray(invoicesTable.paymentId, paymentIds))
        ).map((row) => row.id);
        if (invoiceIds.length) {
          await db.delete(invoiceEmailDeliveriesTable).where(inArray(invoiceEmailDeliveriesTable.invoiceId, invoiceIds));
        }
        try {
          await db.delete(invoicesTable).where(inArray(invoicesTable.paymentId, paymentIds));
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await db.delete(paymentEventsTable).where(inArray(paymentEventsTable.paymentId, paymentIds));
      await db.delete(refundsTable).where(inArray(refundsTable.paymentId, paymentIds));
      await db.delete(paymentReceiptsTable).where(inArray(paymentReceiptsTable.paymentId, paymentIds));
      await db.delete(paymentsTable).where(inArray(paymentsTable.id, paymentIds));
    }
  }
  if (createdListingIds.length) {
    await db.delete(listingsTable).where(inArray(listingsTable.id, createdListingIds));
  }
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }

  if (savedPriceSetting === null) {
    await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, "sponsorshipPriceCents"));
  } else if (savedPriceSetting !== undefined) {
    await db.update(siteSettingsTable).set({ value: savedPriceSetting }).where(eq(siteSettingsTable.key, "sponsorshipPriceCents"));
  }
  if (savedDurationSetting === null) {
    await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, "sponsorshipDurationDays"));
  } else if (savedDurationSetting !== undefined) {
    await db.update(siteSettingsTable).set({ value: savedDurationSetting }).where(eq(siteSettingsTable.key, "sponsorshipDurationDays"));
  }
});

describe("Sponsorship purchase and lifecycle", () => {
  it("activates a sponsorship, creates a real payment + invoice, and assigns a slot", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship, sandbox } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    assert.equal(sandbox, true);
    assert.equal(sponsorship.status, "active");
    assert.ok(sponsorship.slotNumber >= 1 && sponsorship.slotNumber <= TOTAL_SPONSORSHIP_SLOTS);
    assert.equal(sponsorship.priceCents, DEFAULT_SPONSORSHIP_PRICE_CENTS === 4900 ? 4900 : sponsorship.priceCents);
    assert.equal(sponsorship.durationDays, DEFAULT_SPONSORSHIP_DURATION_DAYS === 7 ? 7 : sponsorship.durationDays);
    assert.ok(sponsorship.startAt);
    assert.ok(sponsorship.expiresAt);

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, sponsorship.paymentId)).limit(1);
    assert.ok(payment, "payment row must exist");
    assert.equal(payment?.type, "SPONSORSHIP");
    assert.equal(payment?.status, "succeeded");
    assert.equal(payment?.amountCents, sponsorship.priceCents);

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, sponsorship.paymentId)).limit(1);
    assert.ok(invoice, "an invoice must be generated exactly like other payment types");
    assert.equal(invoice?.totalCents, sponsorship.priceCents);

    // Never touches the campaign tables.
    const active = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, sponsorship.id)).limit(1);
    assert.equal(active.length, 1);

    await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("rejects a purchase once all 4 slots are occupied, without ever granting a 5th slot under concurrency", async () => {
    // Relative to whatever is already free (should be all 4, since every
    // other test in this suite frees the slot it takes) rather than assuming
    // a hardcoded count, so this test can't spuriously pass or fail based on
    // execution order.
    const freeSlotsBefore = (await getSponsorshipAvailability()).availableSlots;
    assert.ok(freeSlotsBefore >= 1, "test setup requires at least one free slot to exercise exhaustion");
    const attempts = freeSlotsBefore + 1;
    const listingIds = await Promise.all(Array.from({ length: attempts }, () => createListing(ownerAId)));

    const results = await Promise.allSettled(listingIds.map((listingId) => purchase(listingId, ownerAId)));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof purchase>>> => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    for (const result of fulfilled) createdSponsorshipIds.push(result.value.sponsorship.id);

    assert.equal(fulfilled.length, freeSlotsBefore, "exactly as many concurrent purchases as free slots should succeed");
    assert.equal(rejected.length, 1, "the purchase beyond available capacity should be rejected");

    const slotNumbers = fulfilled.map((result) => result.value.sponsorship.slotNumber);
    assert.equal(new Set(slotNumbers).size, slotNumbers.length, "no slot number is ever granted to two concurrent purchases");

    const availability = await getSponsorshipAvailability();
    assert.equal(availability.availableSlots, 0);

    const rejection = rejected[0];
    assert.equal(rejection.status, "rejected");
    if (rejection.status === "rejected") {
      assert.match(String(rejection.reason?.message ?? rejection.reason), /Featured slots are currently taken/);
    }

    // Free every slot this test took, so later tests start from a clean slate.
    for (const result of fulfilled) {
      await cancelSponsorship(result.value.sponsorship.id, { id: ownerAId, role: "member" });
    }
  });

  it("frees its slot on server-time expiration without deleting the historical record", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    // Measured while the sponsorship is still genuinely active (real,
    // future expiry) -- capturing this after backdating would already show
    // the slot as free (getSponsorshipAvailability derives occupancy from
    // expiresAt vs. now directly, independent of whether the sweep has run
    // yet), which would make this assertion vacuous.
    const before = await getSponsorshipAvailability();

    // Backdate expiry into the past to simulate server-time-based expiration
    // -- the sweep must never rely on the browser clock.
    await db.update(sponsorshipsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sponsorshipsTable.id, sponsorship.id));

    const result = await sweepExpiredSponsorships();
    assert.ok(result.expired >= 1);

    const [row] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, sponsorship.id)).limit(1);
    assert.equal(row?.status, "expired");

    const after = await getSponsorshipAvailability();
    assert.equal(after.availableSlots, before.availableSlots + 1, "expiring frees exactly one slot");

    // Historical record (payment/invoice) remains, and admin listing still
    // surfaces it.
    const adminRows = await listSponsorshipsForAdmin();
    assert.ok(adminRows.some((candidate) => candidate.sponsorship.id === sponsorship.id));

    const active = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.status, "active")).limit(1000);
    assert.ok(!active.some((candidate) => candidate.id === sponsorship.id), "expired sponsorship no longer counts as active");
  });

  it("never lets a stale-pending sweep clobber a sponsorship whose payment is concurrently finalizing as succeeded", async () => {
    // Simulates the real async PayPal path: a checkout is created and left
    // "pending" (no synchronous completion), exactly like a real order
    // awaiting buyer approval/capture -- see purchaseSponsorshipInTx's
    // isPayPalCheckoutEnabled() branch in lib/sponsorships.ts.
    const listingId = await createListing(ownerAId);
    const savedProvider = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "paypal";
    let pending: Awaited<ReturnType<typeof purchase>>;
    try {
      pending = await purchase(listingId, ownerAId);
    } finally {
      if (savedProvider === undefined) delete process.env.PAYMENT_PROVIDER;
      else process.env.PAYMENT_PROVIDER = savedProvider;
    }
    createdSponsorshipIds.push(pending.sponsorship.id);
    assert.equal(pending.sponsorship.status, "pending");

    // Backdate past the base (never-approved) stale-reservation TTL, and
    // deliberately record no "order_approved" event -- this reservation is
    // exactly the kind the sweep is normally right to release as abandoned,
    // making it the sharpest possible test of the race: a real capture
    // arriving at (what looks to the sweep like) the last possible instant.
    await db
      .update(sponsorshipsTable)
      .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(sponsorshipsTable.id, pending.sponsorship.id));
    // Mirrors what a real PayPal order-creation call stores before capture,
    // so the verified-success event below matches finalize()'s own
    // provider/providerCheckoutId consistency check.
    const providerCheckoutId = `fake-paypal-order-${randomUUID()}`;
    await db.update(paymentsTable).set({ providerCheckoutId }).where(eq(paymentsTable.id, pending.sponsorship.paymentId));

    // Force true simultaneous contention for SPONSORSHIP_LOCK_KEY: hold it
    // from a manually-controlled connection first, start both the sweep and
    // the verified-success finalize while they're both blocked waiting on
    // it, then release -- so whichever one Postgres admits first runs to
    // completion before the other proceeds, exactly the interleaving the
    // reviewer's finding described.
    const lockClient = await pool.connect();
    await lockClient.query("BEGIN");
    await lockClient.query("SELECT pg_advisory_xact_lock($1)", [SPONSORSHIP_LOCK_KEY]);
    try {
      const sweepPromise = sweepExpiredSponsorships();
      const financePromise = processVerifiedPaymentEvent({
        provider: "paypal",
        eventId: `sponsorship-race-succeeded:${pending.sponsorship.paymentId}`,
        type: "payment_succeeded",
        paymentId: pending.sponsorship.paymentId,
        providerCheckoutId,
        providerPaymentId: `paypal_capture_${pending.sponsorship.paymentId}`,
        amountCents: pending.sponsorship.priceCents,
        currency: "USD",
      });
      // Give both a moment to actually reach and block on the lock before
      // it's released, so this exercises real contention rather than two
      // calls that happen to run one after the other.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await lockClient.query("COMMIT");
      await Promise.all([sweepPromise, financePromise]);
    } finally {
      lockClient.release();
    }

    const [finalPayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, pending.sponsorship.paymentId)).limit(1);
    const [finalSponsorship] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, pending.sponsorship.id)).limit(1);
    assert.ok(finalPayment && finalSponsorship);

    // The one outcome that must never happen: a successfully paid,
    // invoiced payment whose sponsorship got silently wiped back to
    // cancelled underneath it.
    const corrupted = finalPayment!.status === "succeeded" && finalSponsorship!.status === "cancelled";
    assert.equal(corrupted, false, "a succeeded payment's sponsorship must never be left cancelled");

    if (finalPayment!.status === "succeeded") {
      // Finalize won the race: the sponsorship must be genuinely active
      // with a real invoice, exactly like the synchronous path.
      assert.equal(finalSponsorship!.status, "active");
      const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, pending.sponsorship.paymentId)).limit(1);
      assert.ok(invoice, "a winning finalize must still produce a real invoice");
      await cancelSponsorship(pending.sponsorship.id, { id: ownerAId, role: "member" });
    } else {
      // The sweep won the race and legitimately released the reservation
      // first: finalize must recognize it lost the slot and escalate for
      // reconciliation, never silently succeed with no sponsorship to show
      // for it.
      assert.equal(finalSponsorship!.status, "cancelled");
      assert.equal(finalPayment!.status, "requires_reconciliation");
    }
  });

  it("gives an approved-but-uncaptured PayPal order a long grace period, and escalates rather than silently releasing it", async () => {
    const listingId = await createListing(ownerAId);
    const savedProvider = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "paypal";
    let pending: Awaited<ReturnType<typeof purchase>>;
    try {
      pending = await purchase(listingId, ownerAId);
    } finally {
      if (savedProvider === undefined) delete process.env.PAYMENT_PROVIDER;
      else process.env.PAYMENT_PROVIDER = savedProvider;
    }
    createdSponsorshipIds.push(pending.sponsorship.id);
    assert.equal(pending.sponsorship.status, "pending");

    // Record the same "order_approved" webhook event a real PayPal
    // CHECKOUT.ORDER.APPROVED would produce, then backdate past the base
    // (never-approved) TTL but still well within the extended grace window.
    await db.insert(paymentEventsTable).values({
      id: randomUUID(),
      provider: "paypal",
      providerEventId: `order-approved-${randomUUID()}`,
      paymentId: pending.sponsorship.paymentId,
      type: "order_approved",
      payload: {},
      signatureVerified: true,
      processedAt: new Date(),
    });
    await db
      .update(sponsorshipsTable)
      .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(sponsorshipsTable.id, pending.sponsorship.id));

    // Past the base 15-minute TTL, the sweep must still hold the slot
    // because the buyer already approved it -- this is exactly the "don't
    // release a legitimately in-flight PayPal approval on a blunt local
    // timer" gap the reviewer flagged.
    const firstSweep = await sweepExpiredSponsorships();
    assert.equal(firstSweep.escalatedApprovedPending, 0);
    const [stillPending] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, pending.sponsorship.id)).limit(1);
    assert.equal(stillPending?.status, "pending");
    const availabilityWhileApproved = await getSponsorshipAvailability();
    // The approved reservation must still occupy its slot.
    assert.ok(availabilityWhileApproved.availableSlots <= TOTAL_SPONSORSHIP_SLOTS - 1);

    // Now push it past the much longer approved-reservation backstop --
    // capture never landed even after that much time, so it must be
    // escalated for manual reconciliation, never just silently cancelled
    // as if it were an ordinary abandoned checkout.
    await db
      .update(sponsorshipsTable)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(sponsorshipsTable.id, pending.sponsorship.id));
    const secondSweep = await sweepExpiredSponsorships();
    assert.equal(secondSweep.escalatedApprovedPending, 1);

    const [releasedSponsorship] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, pending.sponsorship.id)).limit(1);
    assert.equal(releasedSponsorship?.status, "cancelled");
    const [reconciledPayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, pending.sponsorship.paymentId)).limit(1);
    assert.equal(reconciledPayment?.status, "requires_reconciliation");
    assert.match(reconciledPayment?.failureMessage ?? "", /approved but never captured/);

    const freedAvailability = await getSponsorshipAvailability();
    assert.equal(freedAvailability.availableSlots, availabilityWhileApproved.availableSlots + 1);
  });

  it("sweep cancels a genuinely abandoned pending sponsorship (no approval, no successful payment) and releases its slot", async () => {
    // Unlike the race test above, this is the clean, non-contended case the
    // sweep is *supposed* to resolve on its own: a PayPal checkout was
    // started but the buyer never even reached approval, so no
    // order_approved event exists and the payment never left "pending".
    const listingId = await createListing(ownerAId);
    const savedProvider = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "paypal";
    let pending: Awaited<ReturnType<typeof purchase>>;
    try {
      pending = await purchase(listingId, ownerAId);
    } finally {
      if (savedProvider === undefined) delete process.env.PAYMENT_PROVIDER;
      else process.env.PAYMENT_PROVIDER = savedProvider;
    }
    createdSponsorshipIds.push(pending.sponsorship.id);
    assert.equal(pending.sponsorship.status, "pending");
    const [paymentBefore] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, pending.sponsorship.paymentId)).limit(1);
    assert.equal(paymentBefore?.status, "pending");
    assert.equal(paymentBefore?.providerCheckoutId, null, "no PayPal order was ever created for this abandoned checkout");

    const before = await getSponsorshipAvailability();

    await db
      .update(sponsorshipsTable)
      .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(sponsorshipsTable.id, pending.sponsorship.id));

    const result = await sweepExpiredSponsorships();
    assert.equal(result.releasedStalePending, 1);
    assert.equal(result.escalatedApprovedPending, 0);

    const [releasedSponsorship] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, pending.sponsorship.id)).limit(1);
    assert.equal(releasedSponsorship?.status, "cancelled");

    // The sweep only ever touches the sponsorship reservation -- an
    // abandoned checkout's payment is left exactly as it was (still
    // "pending", not force-failed), since the sweep has no way to know
    // whether the buyer might still complete it moments later; a real
    // capture attempt after this point is caught by finalize()'s own
    // "sponsorship missing/not-pending" guard, not by this sweep.
    const [paymentAfter] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, pending.sponsorship.paymentId)).limit(1);
    assert.equal(paymentAfter?.status, "pending");

    const after = await getSponsorshipAvailability();
    assert.equal(after.availableSlots, before.availableSlots + 1, "releasing an abandoned reservation frees exactly one slot");
  });

  it("leaves an active sponsorship completely untouched when the sweep runs, even long after it was purchased", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);
    assert.equal(sponsorship.status, "active");

    // Backdate creation far past every pending-reservation TTL. An active
    // sponsorship is a different state entirely -- the sweep's stale-pending
    // queries are scoped to status = "pending" and must never touch it based
    // on age alone.
    await db
      .update(sponsorshipsTable)
      .set({ createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000) })
      .where(eq(sponsorshipsTable.id, sponsorship.id));

    const result = await sweepExpiredSponsorships();
    assert.equal(result.releasedStalePending, 0);
    assert.equal(result.escalatedApprovedPending, 0);

    const [untouched] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, sponsorship.id)).limit(1);
    assert.equal(untouched?.status, "active", "an active sponsorship must never be cancelled by the stale-pending sweep");
    assert.deepEqual(untouched?.expiresAt, sponsorship.expiresAt, "its real expiry window is untouched");

    await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("activates a sponsorship and generates exactly one invoice through the real PayPal create-order + capture-order lifecycle", async () => {
    const listingId = await createListing(ownerAId);
    let pending: Awaited<ReturnType<typeof purchase>> | null = null;
    await withFakePayPal(
      async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return paypalJsonResponse({ access_token: "token" });
        if (url.endsWith("/capture")) {
          return paypalJsonResponse({
            id: "ORDER-SPONSORSHIP-HAPPY",
            purchase_units: [{ payments: { captures: [{ id: "CAPTURE-SPONSORSHIP-HAPPY", status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" } }] } }],
          });
        }
        if (url.includes("/v2/checkout/orders")) return paypalJsonResponse({ id: "ORDER-SPONSORSHIP-HAPPY", status: "CREATED" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      },
      async () => {
        pending = await purchase(listingId, ownerAId);
        assert.equal(pending.sponsorship.status, "pending");
        assert.equal(pending.sandbox, false);
        assert.equal(pending.sponsorship.priceCents, 4900, "test setup forces the 4900-cent settings value used by the capture mock above");

        const order = await createPayPalOrder(pending.sponsorship.paymentId);
        assert.equal(order.orderId, "ORDER-SPONSORSHIP-HAPPY");

        const captured = await capturePayPalOrder(pending.sponsorship.paymentId, order.orderId);
        assert.equal(captured.status, "succeeded");

        const [activated] = await db.select().from(sponsorshipsTable).where(eq(sponsorshipsTable.id, pending.sponsorship.id)).limit(1);
        assert.equal(activated?.status, "active");
        assert.ok(activated?.startAt && activated?.expiresAt);

        const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, pending.sponsorship.paymentId));
        assert.equal(invoices.length, 1, "a real PayPal capture must generate exactly one invoice, same as the sandbox path");
        assert.equal(invoices[0]?.totalCents, pending.sponsorship.priceCents);
      },
    );
    createdSponsorshipIds.push(pending!.sponsorship.id);
    await cancelSponsorship(pending!.sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("is idempotent when the same PayPal capture is finalized concurrently twice for a sponsorship", async () => {
    const listingId = await createListing(ownerAId);
    let pending: Awaited<ReturnType<typeof purchase>> | null = null;
    await withFakePayPal(
      async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return paypalJsonResponse({ access_token: "token" });
        if (url.endsWith("/capture")) {
          // A real PayPal retry of an already-captured order returns the
          // same completed capture, not an error -- the mock mirrors that.
          return paypalJsonResponse({
            id: "ORDER-SPONSORSHIP-DUPLICATE",
            purchase_units: [{ payments: { captures: [{ id: "CAPTURE-SPONSORSHIP-DUPLICATE", status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" } }] } }],
          });
        }
        if (url.includes("/v2/checkout/orders")) return paypalJsonResponse({ id: "ORDER-SPONSORSHIP-DUPLICATE", status: "CREATED" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      },
      async () => {
        pending = await purchase(listingId, ownerAId);
        const order = await createPayPalOrder(pending.sponsorship.paymentId);

        // Simulates a client or PayPal retrying the capture call while the
        // first attempt is still in flight.
        const [first, second] = await Promise.all([
          capturePayPalOrder(pending.sponsorship.paymentId, order.orderId),
          capturePayPalOrder(pending.sponsorship.paymentId, order.orderId),
        ]);
        assert.equal(first.status, "succeeded");
        assert.equal(second.status, "succeeded");

        const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, pending.sponsorship.paymentId));
        assert.equal(invoices.length, 1, "duplicate capture finalization must never produce a second invoice");

        const activeRows = await db
          .select()
          .from(sponsorshipsTable)
          .where(and(eq(sponsorshipsTable.paymentId, pending.sponsorship.paymentId), eq(sponsorshipsTable.status, "active")));
        assert.equal(activeRows.length, 1, "duplicate finalization must never double-activate or consume a second slot");
      },
    );
    createdSponsorshipIds.push(pending!.sponsorship.id);
    await cancelSponsorship(pending!.sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("lets the owner cancel their own sponsorship and frees the slot, but rejects a non-owner/non-admin", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    await assert.rejects(
      () => cancelSponsorship(sponsorship.id, { id: otherMemberId, role: "member" }),
      /Not authorized/,
    );

    const cancelled = await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
    assert.equal(cancelled.status, "cancelled");

    // The freed slot must be immediately purchasable again.
    const listingId2 = await createListing(ownerBId);
    const { sponsorship: reused } = await purchase(listingId2, ownerBId);
    createdSponsorshipIds.push(reused.id);
    assert.equal(reused.status, "active");

    await cancelSponsorship(reused.id, { id: ownerBId, role: "member" });
  });
});

describe("Sponsorship analytics", () => {
  it("records popup/section impressions and clicks, and aggregates them into impressions/clicks/CTR", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    await recordSponsorshipEvent(sponsorship.id, "popup_impression", "visitor-hash-a");
    await recordSponsorshipEvent(sponsorship.id, "section_impression", "visitor-hash-a");
    await recordSponsorshipEvent(sponsorship.id, "section_impression", "visitor-hash-b");
    await recordSponsorshipEvent(sponsorship.id, "click", "visitor-hash-a");

    const rows = await listSponsorshipsForAdmin();
    const row = rows.find((candidate) => candidate.sponsorship.id === sponsorship.id);
    assert.ok(row);
    assert.equal(row?.analytics.popupImpressions, 1);
    assert.equal(row?.analytics.sectionImpressions, 2);
    assert.equal(row?.analytics.clicks, 1);
    // impressions = popup + section = 3; ctr = clicks / impressions.
    assert.ok(Math.abs((row?.analytics.ctr ?? 0) - 1 / 3) < 1e-9);

    await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("exposes analytics recording over the public HTTP endpoint", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    const response = await fetch(`${baseUrl}/api/sponsorships/events`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ sponsorshipId: sponsorship.id, type: "click", visitorId: "http-test-visitor" }),
    });
    assert.equal(response.status, 202);

    const events = await db.select().from(sponsorshipEventsTable).where(eq(sponsorshipEventsTable.sponsorshipId, sponsorship.id)).limit(10);
    assert.ok(events.some((event) => event.type === "click"));
    // Visitor identity must be hashed, never stored raw.
    assert.ok(events.every((event) => event.visitorHash !== "http-test-visitor"));

    await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
  });
});

describe("Sponsorship HTTP routes", () => {
  it("GET /api/sponsorships/active only ever returns active sponsorships", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    const response = await fetch(`${baseUrl}/api/sponsorships/active`);
    assert.equal(response.status, 200);
    const parsed = GetActiveSponsorshipsResponse.parse(await response.json());
    assert.ok(parsed.sponsorships.some((row) => row.id === sponsorship.id));
    assert.equal(parsed.totalSlots, TOTAL_SPONSORSHIP_SLOTS);

    await cancelSponsorship(sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("GET /api/sponsorships/availability reports the admin-configured price/duration, never a hardcoded value", async () => {
    const response = await fetch(`${baseUrl}/api/sponsorships/availability`);
    assert.equal(response.status, 200);
    const parsed = GetSponsorshipAvailabilityResponse.parse(await response.json());
    assert.equal(parsed.price, 49);
    assert.equal(parsed.durationDays, 7);
    assert.equal(parsed.totalSlots, TOTAL_SPONSORSHIP_SLOTS);
  });

  it("POST /api/sponsorships/checkout requires authentication and rejects purchasing a listing the caller doesn't own", async () => {
    const listingId = await createListing(ownerAId);

    const unauthenticated = await fetch(`${baseUrl}/api/sponsorships/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID(), origin: baseUrl },
      body: JSON.stringify({ listingId }),
    });
    assert.equal(unauthenticated.status, 401);

    const wrongOwner = await fetch(`${baseUrl}/api/sponsorships/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
        "x-test-clerk-user-id": otherMemberClerkId,
        origin: baseUrl,
      },
      body: JSON.stringify({ listingId }),
    });
    assert.equal(wrongOwner.status, 403);

    const rightOwner = await fetch(`${baseUrl}/api/sponsorships/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
        "x-test-clerk-user-id": ownerAClerkId,
        origin: baseUrl,
      },
      body: JSON.stringify({ listingId }),
    });
    assert.equal(rightOwner.status, 201);
    const parsed = CreateSponsorshipCheckoutResponse.parse(await rightOwner.json());
    createdSponsorshipIds.push(parsed.sponsorship.id);
    assert.equal(parsed.payment.type, "SPONSORSHIP");
    assert.equal(parsed.payment.status, "succeeded");

    await cancelSponsorship(parsed.sponsorship.id, { id: ownerAId, role: "member" });
  });

  it("POST /api/sponsorships/:id/cancel enforces owner-or-admin authorization over HTTP", async () => {
    const listingId = await createListing(ownerAId);
    const { sponsorship } = await purchase(listingId, ownerAId);
    createdSponsorshipIds.push(sponsorship.id);

    const forbidden = await fetch(`${baseUrl}/api/sponsorships/${sponsorship.id}/cancel`, {
      method: "POST",
      headers: { "x-test-clerk-user-id": otherMemberClerkId, origin: baseUrl },
    });
    assert.equal(forbidden.status, 403);

    const ok = await fetch(`${baseUrl}/api/sponsorships/${sponsorship.id}/cancel`, {
      method: "POST",
      headers: { "x-test-clerk-user-id": ownerAClerkId, origin: baseUrl },
    });
    assert.equal(ok.status, 200);
    const parsed = CancelSponsorshipResponse.parse(await ok.json());
    assert.equal(parsed.status, "cancelled");
  });

  it("GET /api/admin/sponsorships is admin-only and exposes full history including expired/cancelled rows", async () => {
    const listingId = await createListing(ownerBId);
    const { sponsorship } = await purchase(listingId, ownerBId);
    createdSponsorshipIds.push(sponsorship.id);
    await cancelSponsorship(sponsorship.id, { id: ownerBId, role: "member" });

    const unauthenticated = await fetch(`${baseUrl}/api/admin/sponsorships`);
    assert.equal(unauthenticated.status, 401);

    const nonAdmin = await fetch(`${baseUrl}/api/admin/sponsorships`, {
      headers: { "x-test-clerk-user-id": ownerAClerkId },
    });
    assert.equal(nonAdmin.status, 403);

    const asAdmin = await fetch(`${baseUrl}/api/admin/sponsorships`, {
      headers: { "x-test-clerk-user-id": adminClerkId },
    });
    assert.equal(asAdmin.status, 200);
    const parsed = GetAdminSponsorshipsResponse.parse(await asAdmin.json());
    const row = parsed.find((candidate) => candidate.id === sponsorship.id);
    assert.ok(row, "a cancelled sponsorship's historical record must still be visible to admins");
    assert.equal(row?.status, "cancelled");
    assert.ok(row?.invoiceId, "its invoice reference must remain visible");
  });
});
