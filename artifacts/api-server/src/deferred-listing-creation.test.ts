import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  invoiceEmailDeliveriesTable,
  invoicesTable,
  ledgerEntriesTable,
  listingsTable,
  paymentEventsTable,
  paymentReceiptsTable,
  paymentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { ensureCurrentCampaign } from "./lib/campaigns";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";
import {
  createAndCompleteTestCheckout,
  createCheckout,
  processVerifiedPaymentEvent,
  type CheckoutInput,
  type PendingListingDraft,
} from "./lib/payments";

// Covers project task #55: a public "create a new listing" checkout (via
// /public/campaign-bids or /public/listings/checkout) must never claim a
// slug or website until its payment verifiably succeeds. These tests drive
// the underlying lib/payments.ts primitives directly (createCheckout +
// processVerifiedPaymentEvent, exactly what the PayPal direct-capture and
// webhook paths call) rather than the HTTP routes, so success/failure/race
// outcomes at finalize() can be asserted precisely without needing a live
// PayPal sandbox round trip.

let campaignId = "";
const createdListingIds: string[] = [];
const createdPaymentIds: string[] = [];

before(async () => {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  campaignId = campaign.id;
});

// A completed test checkout schedules its invoice delivery as an un-awaited
// background task, so a delivery row can still be inserting when cleanup
// runs; retry the delete a few times to let any in-flight attempt settle
// instead of racing it into a foreign-key violation.
async function purgeInvoiceForPayment(paymentId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoiceRows = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.paymentId, paymentId));
    if (!invoiceRows.length) return;
    for (const invoice of invoiceRows) {
      await db.delete(invoiceEmailDeliveriesTable).where(eq(invoiceEmailDeliveriesTable.invoiceId, invoice.id));
    }
    try {
      await db.delete(invoicesTable).where(eq(invoicesTable.paymentId, paymentId));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.paymentId, paymentId));
}

after(async () => {
  // payment_events and ledger_entries both reference payments, and payments
  // references listings with onDelete: restrict -- children must go first.
  for (const id of createdPaymentIds) {
    await purgeInvoiceForPayment(id);
    await db.delete(paymentEventsTable).where(eq(paymentEventsTable.paymentId, id));
    await db.delete(paymentReceiptsTable).where(eq(paymentReceiptsTable.paymentId, id));
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, id));
    await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
  }
  for (const id of createdListingIds) {
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.listingId, id));
    await db.delete(listingsTable).where(eq(listingsTable.id, id));
  }
});

function draftFor(seed: string, overrides: Partial<PendingListingDraft> = {}): PendingListingDraft {
  return {
    id: randomUUID(),
    slug: `deferred-${seed}`,
    name: `Deferred Test ${seed}`,
    tagline: "A deferred-creation test listing.",
    description: "Created only once its payment succeeds.",
    category: "Testing",
    initials: "DT",
    accent: "slate",
    websiteUrl: `https://deferred-${seed}.example.test`,
    demoVideoUrl: null,
    ownerId: null,
    ownerEmail: `deferred-${seed}@example.test`,
    ownerName: null,
    managementTokenHash: randomUUID(),
    managementTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
    ...overrides,
  };
}

function newListingInput(draft: PendingListingDraft, amountCents = 600): CheckoutInput {
  return {
    listingId: null,
    campaignId,
    userId: null,
    type: "OWNER_BID",
    amountCents,
    reason: "Initial campaign bid",
    receiptEmail: draft.ownerEmail,
    idempotencyKey: `deferred-test:${draft.id}`,
    metadata: { publicCampaignBid: true, requestedOwnerBidCents: amountCents, pendingListing: draft },
  };
}

async function listingCountFor(websiteUrl: string) {
  const rows = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(eq(listingsTable.websiteUrl, websiteUrl));
  return rows.length;
}

describe("deferred new-listing checkout creation", () => {
  it("creates no listing while a new-listing payment is pending", async () => {
    const draft = draftFor(`pending-${randomUUID()}`);
    const payment = await createCheckout(newListingInput(draft));
    createdPaymentIds.push(payment.id);
    assert.equal(payment.status, "pending");
    assert.equal(payment.listingId, null);
    assert.equal(await listingCountFor(draft.websiteUrl), 0);
  });

  it("materializes exactly one listing, atomically, only once the payment succeeds", async () => {
    const draft = draftFor(`success-${randomUUID()}`);
    const input = newListingInput(draft, 750);
    const payment = await createCheckout(input);
    createdPaymentIds.push(payment.id);
    assert.equal(await listingCountFor(draft.websiteUrl), 0);

    const result = await processVerifiedPaymentEvent({
      provider: "test",
      eventId: `deferred-test-succeeded:${payment.id}`,
      type: "payment_succeeded",
      paymentId: payment.id,
      providerPaymentId: `test_payment_${payment.id}`,
      amountCents: input.amountCents,
      currency: "USD",
    });
    assert.ok(result.payment);
    assert.equal(result.payment!.status, "succeeded");
    assert.ok(result.payment!.listingId);
    createdListingIds.push(result.payment!.listingId!);

    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, result.payment!.listingId!))
      .limit(1);
    assert.ok(listing);
    assert.equal(listing.slug, draft.slug);
    assert.equal(listing.websiteUrl, draft.websiteUrl);
    assert.equal(listing.ownerBidCents, 0);
    assert.equal(await listingCountFor(draft.websiteUrl), 1);

    const ledgerEntries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.paymentId, payment.id));
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].amountCents, 750);
    assert.equal(ledgerEntries[0].listingId, listing.id);
  });

  it("claims no slug or website when the payment fails", async () => {
    const draft = draftFor(`failed-${randomUUID()}`);
    const payment = await createCheckout(newListingInput(draft));
    createdPaymentIds.push(payment.id);

    const result = await processVerifiedPaymentEvent({
      provider: "test",
      eventId: `deferred-test-failed:${payment.id}`,
      type: "payment_failed",
      paymentId: payment.id,
      failureCode: "provider_declined",
      failureMessage: "Simulated decline for test coverage",
    });
    assert.ok(result.payment);
    assert.equal(result.payment!.status, "failed");
    assert.equal(result.payment!.listingId, null);
    assert.equal(await listingCountFor(draft.websiteUrl), 0);
  });

  it("resolves a same-website race to exactly one listing, marking the loser for reconciliation", async () => {
    const sharedWebsite = `https://deferred-race-${randomUUID()}.example.test`;
    const winnerDraft = draftFor(`race-winner-${randomUUID()}`, { websiteUrl: sharedWebsite });
    const loserDraft = draftFor(`race-loser-${randomUUID()}`, { websiteUrl: sharedWebsite });

    const winnerPayment = await createCheckout(newListingInput(winnerDraft));
    const loserPayment = await createCheckout(newListingInput(loserDraft));
    createdPaymentIds.push(winnerPayment.id, loserPayment.id);

    const winnerResult = await processVerifiedPaymentEvent({
      provider: "test",
      eventId: `deferred-race-winner:${winnerPayment.id}`,
      type: "payment_succeeded",
      paymentId: winnerPayment.id,
      providerPaymentId: `test_payment_${winnerPayment.id}`,
      amountCents: winnerPayment.amountCents,
      currency: "USD",
    });
    assert.ok(winnerResult.payment);
    assert.equal(winnerResult.payment!.status, "succeeded");
    assert.ok(winnerResult.payment!.listingId);
    createdListingIds.push(winnerResult.payment!.listingId!);

    const loserResult = await processVerifiedPaymentEvent({
      provider: "test",
      eventId: `deferred-race-loser:${loserPayment.id}`,
      type: "payment_succeeded",
      paymentId: loserPayment.id,
      providerPaymentId: `test_payment_${loserPayment.id}`,
      amountCents: loserPayment.amountCents,
      currency: "USD",
    });
    assert.ok(loserResult.payment);
    assert.equal(loserResult.payment!.status, "requires_reconciliation");
    assert.equal(loserResult.payment!.listingId, null);
    assert.match(loserResult.payment!.failureMessage ?? "", /claimed by another completed payment/);

    // Exactly one listing exists for the contested website -- the loser was
    // never silently dropped (payment marked for reconciliation, not
    // discarded) nor duplicated (no second listings row).
    assert.equal(await listingCountFor(sharedWebsite), 1);
    const loserLedger = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.paymentId, loserPayment.id));
    assert.equal(loserLedger.length, 0);
  });

  it("leaves the existing owner-bid-increase flow (real listingId) unchanged", async () => {
    const listingId = `deferred-existing-${randomUUID()}`;
    await db.insert(listingsTable).values({
      id: listingId,
      name: "Existing Listing For Bid Increase",
      slug: `deferred-existing-${randomUUID()}`,
      tagline: "Already on the leaderboard.",
      description: "Used to confirm bid increases on existing listings are unaffected.",
      category: "Testing",
      initials: "EX",
      accent: "slate",
      ownerBidCents: 0,
    });
    createdListingIds.push(listingId);

    const payment = await createAndCompleteTestCheckout({
      listingId,
      campaignId,
      userId: null,
      type: "OWNER_BID",
      amountCents: 900,
      reason: "Owner increased campaign bid",
      receiptEmail: "existing@example.test",
      idempotencyKey: `deferred-existing-bid:${listingId}`,
      metadata: { publicCampaignBid: true, listingId, requestedOwnerBidCents: 900 },
    });
    createdPaymentIds.push(payment.id);
    assert.equal(payment.status, "succeeded");
    assert.equal(payment.listingId, listingId);

    const ledgerEntries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.paymentId, payment.id));
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].amountCents, 900);
    assert.equal(ledgerEntries[0].listingId, listingId);
  });
});
