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
  refundsTable,
  siteSettingsTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ensureCurrentCampaign } from "./lib/campaigns";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";
import {
  createAndCompleteTestCheckout,
  createCheckout,
  createRefund,
  processVerifiedPaymentEvent,
  type CheckoutInput,
} from "./lib/payments";
import { deliverInvoice, getInvoiceForPayment, getInvoicePdfBuffer, listInvoicesForUser } from "./lib/invoices";
// Used only to assert on the actual rendered text of a generated invoice
// PDF (pdfkit compresses content streams by default, so a raw buffer
// search can't find the text) -- test-only, never used in application code.
import { PDFParse } from "pdf-parse";

async function extractPdfText(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

// Covers project task #66 (automatic invoicing): every successful
// OWNER_BID/COMMUNITY_BID/PENALTY payment must produce exactly one
// sequentially numbered invoice, pending/failed/cancelled payments must
// never get one, duplicate finalize calls must never duplicate the
// invoice, ownership must be scoped per user, and a refund must update the
// existing invoice's status in place rather than issuing a new document.

let campaignId = "";
let listingId = "";
const createdListingIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdUserIds: string[] = [];

before(async () => {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  campaignId = campaign.id;
  const [listing] = await db
    .insert(listingsTable)
    .values({
      id: randomUUID(),
      name: "Invoice Test Listing",
      slug: `invoice-test-${randomUUID()}`,
      tagline: "Invoicing coverage fixture",
      description: "Used only by invoices.test.ts",
      category: "Testing",
      initials: "IT",
      accent: "slate",
      websiteUrl: `https://invoice-test-${randomUUID()}.example.test`,
      ownerBidCents: 0,
    })
    .returning();
  listingId = listing.id;
  createdListingIds.push(listingId);
});

// Every completed test checkout schedules its invoice delivery as an
// un-awaited background task (deliberately, so a payment's own response
// never waits on email/PDF work -- see triggerInvoiceDeliveryForPayment).
// That means a delivery row can still be inserting when cleanup runs;
// retrying the delete a few times lets any in-flight attempt settle
// instead of racing it into a foreign-key violation.
async function purgeInvoicesForListing(id: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoiceRows = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.listingId, id));
    if (!invoiceRows.length) return;
    for (const invoice of invoiceRows) {
      await db.delete(invoiceEmailDeliveriesTable).where(eq(invoiceEmailDeliveriesTable.invoiceId, invoice.id));
    }
    try {
      await db.delete(invoicesTable).where(eq(invoicesTable.listingId, id));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.listingId, id));
}

after(async () => {
  await purgeInvoicesForListing(listingId);
  for (const id of createdPaymentIds) {
    await db.delete(paymentEventsTable).where(eq(paymentEventsTable.paymentId, id));
    await db.delete(paymentReceiptsTable).where(eq(paymentReceiptsTable.paymentId, id));
    await db.delete(refundsTable).where(eq(refundsTable.paymentId, id));
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, id));
    await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
  }
  for (const id of createdListingIds) {
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.listingId, id));
    await db.delete(listingsTable).where(eq(listingsTable.id, id));
  }
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

async function insertTestUser(): Promise<string> {
  const id = randomUUID();
  createdUserIds.push(id);
  await db.insert(usersTable).values({
    id,
    clerkUserId: `invoice-test-clerk-${id}`,
    email: `invoice-test-${id}@example.test`,
    displayName: "Invoice Test Owner",
    role: "member",
    status: "active",
  });
  return id;
}

function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    listingId,
    campaignId,
    userId: null,
    type: "COMMUNITY_BID",
    amountCents: 500,
    reason: "Invoice coverage test",
    receiptEmail: "payer@example.test",
    idempotencyKey: `invoice-test:${randomUUID()}`,
    ...overrides,
  };
}

describe("automatic invoicing", () => {
  it("issues exactly one sequentially numbered invoice for a succeeded payment, per payment type", async () => {
    for (const type of ["OWNER_BID", "COMMUNITY_BID", "PENALTY"] as const) {
      const payment = await createAndCompleteTestCheckout(checkoutInput({ type }));
      createdPaymentIds.push(payment.id);
      assert.equal(payment.status, "succeeded");

      const invoice = await getInvoiceForPayment(payment.id);
      assert.ok(invoice, `expected an invoice for a succeeded ${type} payment`);
      assert.match(invoice!.invoiceNumber, /^UPB-\d{4}-\d{6}$/);
      assert.equal(invoice!.paymentId, payment.id);
      assert.equal(invoice!.type, type);
      assert.equal(invoice!.status, "PAID");
      assert.equal(invoice!.listingId, listingId);
      assert.equal(invoice!.listingName, "Invoice Test Listing");
      assert.equal(invoice!.billingEmail, "payer@example.test");
      assert.equal(invoice!.totalCents, payment.amountCents);
    }
  });

  it("never creates an invoice for a payment that is only pending", async () => {
    const payment = await createCheckout(checkoutInput());
    createdPaymentIds.push(payment.id);
    assert.equal(payment.status, "pending");
    const invoice = await getInvoiceForPayment(payment.id);
    assert.equal(invoice, null);
  });

  it("never creates an invoice for a failed or cancelled payment", async () => {
    for (const eventType of ["payment_failed", "payment_cancelled"] as const) {
      const payment = await createCheckout(checkoutInput());
      createdPaymentIds.push(payment.id);
      const result = await processVerifiedPaymentEvent({
        provider: "test",
        eventId: `invoice-test-${eventType}:${payment.id}`,
        type: eventType,
        paymentId: payment.id,
      });
      assert.equal(result.payment?.status, "failed");
      const invoice = await getInvoiceForPayment(payment.id);
      assert.equal(invoice, null, `${eventType} must never produce an invoice`);
    }
  });

  it("never duplicates an invoice when a webhook event is replayed after success", async () => {
    const payment = await createAndCompleteTestCheckout(checkoutInput());
    createdPaymentIds.push(payment.id);
    const before = await getInvoiceForPayment(payment.id);
    assert.ok(before);

    // Replays the exact same succeeded event again, as a duplicate webhook
    // delivery would -- finalize()'s monotonic status check must short
    // circuit before invoice creation is even attempted a second time.
    const replay = await processVerifiedPaymentEvent({
      provider: "test",
      eventId: `invoice-test-replay:${payment.id}`,
      type: "payment_succeeded",
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId ?? undefined,
      amountCents: payment.amountCents,
      currency: payment.currency,
    });
    assert.equal(replay.duplicate, false);
    const after = await getInvoiceForPayment(payment.id);
    assert.equal(after?.id, before!.id);
    assert.equal(after?.invoiceNumber, before!.invoiceNumber);

    const allForPayment = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, payment.id));
    assert.equal(allForPayment.length, 1);
  });

  it("scopes an owner's invoice list to only their own payments", async () => {
    const ownerA = await insertTestUser();
    const ownerB = await insertTestUser();
    const paymentA = await createAndCompleteTestCheckout(checkoutInput({ userId: ownerA, type: "OWNER_BID" }));
    const paymentB = await createAndCompleteTestCheckout(checkoutInput({ userId: ownerB, type: "OWNER_BID" }));
    createdPaymentIds.push(paymentA.id, paymentB.id);

    const invoicesForA = await listInvoicesForUser(ownerA);
    const invoicesForB = await listInvoicesForUser(ownerB);
    assert.ok(invoicesForA.some((invoice) => invoice.paymentId === paymentA.id));
    assert.ok(!invoicesForA.some((invoice) => invoice.paymentId === paymentB.id));
    assert.ok(invoicesForB.some((invoice) => invoice.paymentId === paymentB.id));
    assert.ok(!invoicesForB.some((invoice) => invoice.paymentId === paymentA.id));
  });

  it("reflects a refund onto the existing invoice's status without changing its number", async () => {
    const owner = await insertTestUser();
    // COMMUNITY_BID payments are deliberately non-refundable (see
    // community-bid-refunds policy) -- use OWNER_BID so createRefund's own
    // refundability check doesn't block this invoice-status assertion.
    const payment = await createAndCompleteTestCheckout(checkoutInput({ userId: owner, type: "OWNER_BID", amountCents: 1000 }));
    createdPaymentIds.push(payment.id);
    const original = await getInvoiceForPayment(payment.id);
    assert.ok(original);
    assert.equal(original!.status, "PAID");

    await createRefund({
      paymentId: payment.id,
      userId: owner,
      amountCents: 400,
      reason: "Partial refund for invoice status coverage",
      idempotencyKey: `invoice-test-refund:${payment.id}`,
    });
    const afterPartial = await getInvoiceForPayment(payment.id);
    assert.equal(afterPartial?.invoiceNumber, original!.invoiceNumber);
    assert.equal(afterPartial?.status, "PARTIALLY_REFUNDED");
    assert.equal(afterPartial?.refundedCents, 400);

    await createRefund({
      paymentId: payment.id,
      userId: owner,
      amountCents: 600,
      reason: "Remaining refund for invoice status coverage",
      idempotencyKey: `invoice-test-refund-2:${payment.id}`,
    });
    const afterFull = await getInvoiceForPayment(payment.id);
    assert.equal(afterFull?.invoiceNumber, original!.invoiceNumber);
    assert.equal(afterFull?.status, "REFUNDED");
    assert.equal(afterFull?.refundedCents, 1000);

    const allForPayment = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, payment.id));
    assert.equal(allForPayment.length, 1, "a refund must never create a second invoice");
  });

  it("isolates a client email failure from an admin delivery, and never throws", async () => {
    const payment = await createAndCompleteTestCheckout(checkoutInput({ receiptEmail: "no-provider-configured@example.test" }));
    createdPaymentIds.push(payment.id);
    const invoice = await getInvoiceForPayment(payment.id);
    assert.ok(invoice);

    // createAndCompleteTestCheckout already scheduled its own background
    // delivery (see triggerInvoiceDeliveryForPayment) the instant the
    // payment finalized -- this explicit call is deliberately concurrent
    // with that automatic one, since the atomic per-recipient claim (see
    // claimDeliveryAttempt) must make that race harmless: whichever caller
    // wins the claim sends, the other is a no-op, and either way this call
    // itself must resolve without throwing.
    await assert.doesNotReject(deliverInvoice(invoice!.id));

    // Because the automatic background delivery may still be the one
    // in-flight (it can outlive this call if it lost/won the claim race
    // differently), poll for both recipients to reach a terminal status
    // instead of asserting on a single immediate read.
    type Delivery = typeof invoiceEmailDeliveriesTable.$inferSelect;
    let client: Delivery | undefined;
    let admin: Delivery | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const deliveries: Delivery[] = await db
        .select()
        .from(invoiceEmailDeliveriesTable)
        .where(eq(invoiceEmailDeliveriesTable.invoiceId, invoice!.id));
      client = deliveries.find((d) => d.recipientType === "client");
      admin = deliveries.find((d) => d.recipientType === "admin");
      if (client && admin && client.status !== "sending" && admin.status !== "sending") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // This fake .test address is never a deliverable Resend recipient, and
    // no admin notification email is configured in this test's site
    // settings, so both attempts are expected to fail -- but deliverInvoice
    // must complete (not throw) and record each attempt independently
    // rather than one recipient's failure blocking the other's.
    assert.ok(client, "expected a tracked client delivery attempt");
    assert.ok(admin, "expected a tracked admin delivery attempt");
    assert.equal(client!.status, "failed");
    assert.equal(admin!.status, "failed");

    const [withPdf] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice!.id));
    assert.ok(withPdf.pdfObjectPath, "the PDF should still be generated even when email delivery is unconfigured");
  });

  // Covers project task #69 (tax/VAT on invoices): a configured tax rate
  // must split the payment's already-charged amount into a pre-tax
  // subtotal + tax breakdown without ever changing totalCents away from
  // what was actually collected -- an invoice is what a customer
  // reconciles or gets reimbursed against, so the total must always match
  // the real charge.
  async function setTaxSettings(settings: Record<string, string>) {
    for (const [key, value] of Object.entries(settings)) {
      await db
        .insert(siteSettingsTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value } });
    }
  }
  async function clearTaxSettings() {
    await db
      .delete(siteSettingsTable)
      .where(sql`${siteSettingsTable.key} in ('taxRatePercent', 'taxRegistrationNumber', 'taxLabel')`);
  }

  it("splits the charged amount into subtotal + tax when a tax rate is configured, leaving the total unchanged", async () => {
    await setTaxSettings({ taxRatePercent: "18", taxRegistrationNumber: "GSTIN-123", taxLabel: "GST" });
    try {
      const payment = await createAndCompleteTestCheckout(checkoutInput({ amountCents: 1180 }));
      createdPaymentIds.push(payment.id);
      const invoice = await getInvoiceForPayment(payment.id);
      assert.ok(invoice);
      // 1180 cents at a tax-inclusive 18% rate splits into a 1000-cent
      // subtotal and a 180-cent tax component.
      assert.equal(invoice!.totalCents, 1180);
      assert.equal(invoice!.taxCents, 180);
      assert.equal(invoice!.subtotalCents, 1000);
      assert.equal(invoice!.subtotalCents + invoice!.taxCents, invoice!.totalCents);
      // The exact configured rate/label/registration number are
      // snapshotted onto the invoice row itself, not just the resulting
      // taxCents -- this is what lets the PDF print the true configured
      // rate instead of one derived (and possibly rounded away) from
      // whole-cent amounts.
      assert.equal(invoice!.taxRatePercent, "18");
      assert.equal(invoice!.taxRegistrationNumber, "GSTIN-123");
      assert.equal(invoice!.taxLabel, "GST");
    } finally {
      await clearTaxSettings();
    }
  });

  it("keeps taxCents at 0 with no tax rate configured, matching invoices issued before this feature existed", async () => {
    await clearTaxSettings();
    const payment = await createAndCompleteTestCheckout(checkoutInput({ amountCents: 750 }));
    createdPaymentIds.push(payment.id);
    const invoice = await getInvoiceForPayment(payment.id);
    assert.ok(invoice);
    assert.equal(invoice!.taxCents, 0);
    assert.equal(invoice!.subtotalCents, 750);
    assert.equal(invoice!.totalCents, 750);
    assert.equal(invoice!.taxRatePercent, null);
    assert.equal(invoice!.taxRegistrationNumber, null);
    assert.equal(invoice!.taxLabel, null);
  });

  it("prints the exact configured rate on the PDF even when whole-cent rounding would make a derived percentage drift", async () => {
    // 18% of an odd total doesn't divide evenly into whole cents: this
    // regression-tests that the PDF shows the true configured "18", not a
    // value back-derived from taxCents/subtotalCents (which would print
    // as something like "18.06" here).
    await setTaxSettings({ taxRatePercent: "18", taxLabel: "GST" });
    try {
      const payment = await createAndCompleteTestCheckout(checkoutInput({ amountCents: 1000 }));
      createdPaymentIds.push(payment.id);
      const invoice = await getInvoiceForPayment(payment.id);
      assert.ok(invoice);
      assert.equal(invoice!.taxRatePercent, "18");
      const { pdf } = (await getInvoicePdfBuffer(invoice!.id))!;
      const text = await extractPdfText(pdf);
      assert.ok(text.includes("GST (18%)"), "expected the PDF to print the exact configured 18% rate");
      assert.ok(!text.includes("18.0"), "the PDF must never print a rounding-derived percentage like 18.06%");
    } finally {
      await clearTaxSettings();
    }
  });

  it("never rewrites an already-issued invoice's tax rate/label/registration number when Site Settings change afterward", async () => {
    await setTaxSettings({ taxRatePercent: "18", taxRegistrationNumber: "GSTIN-ORIGINAL", taxLabel: "GST" });
    let invoiceId = "";
    try {
      const payment = await createAndCompleteTestCheckout(checkoutInput({ amountCents: 1180 }));
      createdPaymentIds.push(payment.id);
      const invoice = await getInvoiceForPayment(payment.id);
      assert.ok(invoice);
      invoiceId = invoice!.id;

      // Simulate an admin changing the tax configuration after this
      // invoice was already issued.
      await setTaxSettings({ taxRatePercent: "25", taxRegistrationNumber: "GSTIN-CHANGED", taxLabel: "VAT" });

      const [reloaded] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      assert.equal(reloaded.taxRatePercent, "18", "an already-issued invoice's rate must not change");
      assert.equal(reloaded.taxRegistrationNumber, "GSTIN-ORIGINAL");
      assert.equal(reloaded.taxLabel, "GST");

      const { pdf } = (await getInvoicePdfBuffer(invoiceId))!;
      const text = await extractPdfText(pdf);
      assert.ok(text.includes("GST (18%)"), "the (re)generated PDF must still reflect the rate at issuance");
      assert.ok(text.includes("GSTIN-ORIGINAL"), "the (re)generated PDF must still reflect the registration number at issuance");
      assert.ok(!text.includes("GSTIN-CHANGED"));
    } finally {
      await clearTaxSettings();
    }
  });
});
