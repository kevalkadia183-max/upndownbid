import { randomUUID } from "node:crypto";
import {
  db,
  campaignsTable,
  invoiceCountersTable,
  invoiceEmailDeliveriesTable,
  invoicesTable,
  listingsTable,
  siteSettingsTable,
  usersTable,
  type Invoice,
  type Payment,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { renderInvoicePdf } from "./invoicePdf";
import { saveInvoicePdf, readInvoicePdf } from "./invoiceStorage";
import { sendInvoiceEmail } from "./invoiceEmail";
import { DEFAULT_SITE_SETTINGS } from "./policy-content";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const TYPE_LABELS: Record<string, string> = {
  OWNER_BID: "Claim",
  COMMUNITY_BID: "Boost",
  PENALTY: "Push Down",
  SPONSORSHIP: "Featured Sponsorship",
};

// Called exactly once, inside the same transaction that transitions a
// payment to `succeeded` (finalize()'s success branch runs only once per
// payment -- see the monotonic status check there). The payment-id unique
// index is still enforced here as defense in depth: if this were ever
// invoked twice for the same payment, the second call finds and returns the
// original invoice rather than creating a duplicate.
export async function createInvoiceForFinalizedPayment(
  tx: Tx,
  payment: Payment,
  listingId: string,
): Promise<{ invoice: Invoice; created: boolean }> {
  const [listing] = await tx
    .select({ name: listingsTable.name, websiteUrl: listingsTable.websiteUrl })
    .from(listingsTable)
    .where(eq(listingsTable.id, listingId))
    .limit(1);
  const [campaign] = payment.campaignId
    ? await tx
        .select({ number: campaignsTable.number })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, payment.campaignId))
        .limit(1)
    : [undefined];
  const [user] = payment.userId
    ? await tx
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, payment.userId))
        .limit(1)
    : [undefined];

  // Tax-inclusive breakdown: the amount actually charged to the payer
  // (payment.amountCents) never changes here -- it's already the money
  // that moved, and the invoice is what a customer reconciles or gets
  // reimbursed against, so totalCents must keep matching it exactly. When
  // a tax rate is configured, this only re-splits that same total into a
  // pre-tax subtotal and a tax component; when no rate is configured (the
  // default, and always true for invoices issued before this feature),
  // taxCents stays 0 and subtotalCents stays equal to the full amount,
  // identical to previous behavior.
  // The exact configured rate/label/registration number are snapshotted
  // onto the invoice row below (not just the resulting taxCents) -- a
  // later change to Site Settings must never rewrite what an
  // already-issued invoice says, or make its printed percentage drift
  // from what was actually applied (see invoicePdf.ts).
  const taxSettingRows = await tx
    .select({ key: siteSettingsTable.key, value: siteSettingsTable.value })
    .from(siteSettingsTable)
    .where(sql`${siteSettingsTable.key} in ('taxRatePercent', 'taxRegistrationNumber', 'taxLabel')`);
  const taxSettings = Object.fromEntries(taxSettingRows.map((row) => [row.key, row.value]));
  const configuredTaxRate = Number(taxSettings.taxRatePercent);
  const hasTax = Number.isFinite(configuredTaxRate) && configuredTaxRate > 0;
  const taxCents = hasTax
    ? Math.round((payment.amountCents * configuredTaxRate) / (100 + configuredTaxRate))
    : 0;
  const subtotalCents = payment.amountCents - taxCents;
  const taxRatePercent = hasTax ? String(configuredTaxRate) : null;
  const taxRegistrationNumber = hasTax ? taxSettings.taxRegistrationNumber?.trim() || null : null;
  const taxLabel = hasTax ? taxSettings.taxLabel?.trim() || null : null;

  const year = new Date().getUTCFullYear();
  const [counter] = await tx
    .insert(invoiceCountersTable)
    .values({ year, lastSequence: 1 })
    .onConflictDoUpdate({
      target: invoiceCountersTable.year,
      set: { lastSequence: sql`${invoiceCountersTable.lastSequence} + 1` },
    })
    .returning();
  const invoiceNumber = `UPB-${year}-${String(counter.lastSequence).padStart(6, "0")}`;

  const [made] = await tx
    .insert(invoicesTable)
    .values({
      id: randomUUID(),
      invoiceNumber,
      paymentId: payment.id,
      listingId,
      campaignId: payment.campaignId,
      userId: payment.userId,
      type: payment.type,
      status: "PAID",
      currency: payment.currency,
      subtotalCents,
      taxCents,
      taxRatePercent,
      taxRegistrationNumber,
      taxLabel,
      platformFeeCents: payment.platformFeeCents,
      totalCents: payment.amountCents,
      billingName: user?.displayName ?? null,
      billingEmail: payment.receiptEmail,
      listingName: listing?.name ?? null,
      listingWebsiteUrl: listing?.websiteUrl ?? null,
      campaignNumber: campaign?.number ?? null,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      reason: payment.reason,
    })
    .onConflictDoNothing({ target: invoicesTable.paymentId })
    .returning();
  if (made) return { invoice: made, created: true };
  const [existing] = await tx.select().from(invoicesTable).where(eq(invoicesTable.paymentId, payment.id)).limit(1);
  if (!existing) throw new Error("Invoice creation lost a race but no existing invoice row was found");
  return { invoice: existing, created: false };
}

// Reflects a refund onto its invoice's status/refundedCents. The invoice
// row and its number are never regenerated or replaced -- but its stored
// PDF is now considered stale the moment refundedCents changes (see
// ensurePdf's snapshot check), so the next view/download or refund-notice
// send transparently regenerates a PDF that matches this new status,
// instead of ever serving the original pre-refund document as if it were
// still current.
export async function syncInvoiceStatusForPayment(
  tx: Tx,
  paymentId: string,
  refundedCents: number,
  paymentStatus: string,
): Promise<void> {
  const status =
    paymentStatus === "refunded" ? "REFUNDED" : paymentStatus === "partially_refunded" ? "PARTIALLY_REFUNDED" : "PAID";
  await tx
    .update(invoicesTable)
    .set({ status, refundedCents })
    .where(eq(invoicesTable.paymentId, paymentId));
}

export async function getInvoiceById(id: string): Promise<Invoice | null> {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  return row ?? null;
}

export async function getInvoiceForPayment(paymentId: string): Promise<Invoice | null> {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.paymentId, paymentId)).limit(1);
  return row ?? null;
}

export async function listInvoicesForUser(userId: string): Promise<Invoice[]> {
  return db.select().from(invoicesTable).where(eq(invoicesTable.userId, userId)).orderBy(sql`${invoicesTable.issuedAt} desc`);
}

// Used by both the owner-portal and admin download routes: generates the PDF
// on demand if it doesn't exist yet (e.g. an earlier delivery attempt only
// got as far as generating it, or failed before storage), so viewing an
// invoice never depends on a background email having succeeded first.
export async function getInvoicePdfBuffer(invoiceId: string): Promise<{ invoice: Invoice; pdf: Buffer } | null> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) return null;
  const withPdf = await ensurePdf(invoice);
  const pdf = await readInvoicePdf(withPdf.pdfObjectPath!);
  return { invoice: withPdf, pdf };
}

async function getSiteSetting(key: string): Promise<string> {
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return row?.value ?? DEFAULT_SITE_SETTINGS[key] ?? "";
}

// Regenerates the PDF whenever it's missing OR the stored copy was rendered
// for a different refundedCents than the invoice currently has -- this is
// what stops a download (owner portal, admin tab, or an email attachment)
// from ever serving a stale "PAID, $0 refunded" document after a refund
// changes the invoice's status. Comparing the snapshotted cents value (not
// a timestamp) avoids any clock-precision race between this update and the
// row's own updatedAt trigger.
async function ensurePdf(invoice: Invoice): Promise<Invoice> {
  if (invoice.pdfObjectPath && invoice.pdfRefundedCentsAtGeneration === invoice.refundedCents) return invoice;
  // Business identity (name/address/support email) is always read fresh
  // at render time rather than snapshotted onto the invoice row. Tax
  // fields are the opposite: invoice.taxCents, invoice.taxRatePercent,
  // invoice.taxRegistrationNumber, and invoice.taxLabel were all
  // snapshotted together at invoice creation (see
  // createInvoiceForFinalizedPayment) and are passed straight into
  // renderInvoicePdf from the invoice row itself, so a later change to
  // Site Settings can never alter what an already-issued invoice says.
  const [businessName, businessAddress, supportEmail] = await Promise.all([
    getSiteSetting("businessName"),
    getSiteSetting("businessAddress"),
    getSiteSetting("supportEmail"),
  ]);
  const pdf = await renderInvoicePdf(invoice, {
    businessName,
    businessAddress,
    supportEmail,
  });
  const objectPath = await saveInvoicePdf(invoice.id, pdf);
  const [updated] = await db
    .update(invoicesTable)
    .set({ pdfObjectPath: objectPath, pdfGeneratedAt: new Date(), pdfRefundedCentsAtGeneration: invoice.refundedCents })
    .where(eq(invoicesTable.id, invoice.id))
    .returning();
  return updated ?? { ...invoice, pdfObjectPath: objectPath, pdfRefundedCentsAtGeneration: invoice.refundedCents };
}

type RecipientType = "client" | "admin" | "client_refund" | "admin_refund";

// The lease a claim holds before another caller may retry it -- only
// matters if a process crashes between claiming and finalizing (recording
// sent/failed), which would otherwise leave a row stuck in "sending"
// forever and block any future retry.
const DELIVERY_CLAIM_LEASE_MS = 2 * 60 * 1000;

// Atomically claims the right to send one (invoice, recipient) email.
// This is the fix for the real race a fire-and-forget delivery has under
// duplicate/concurrent triggers (e.g. a replayed webhook calling
// triggerInvoiceDeliveryForPayment twice): without a claim, both callers
// would read "no successful delivery yet" and both call the email
// provider before either had a chance to record success. Because this is
// a single INSERT ... ON CONFLICT DO UPDATE ... WHERE statement, Postgres
// serializes concurrent claims on the same (invoiceId, recipientType) row
// via its unique index -- only the first to commit can flip the status to
// "sending"; the second re-evaluates the WHERE guard against the
// now-committed row and gets zero rows back, so it must not send.
async function claimDeliveryAttempt(
  invoiceId: string,
  recipientType: RecipientType,
  recipientEmail: string,
): Promise<boolean> {
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() - DELIVERY_CLAIM_LEASE_MS);
  const [claimed] = await db
    .insert(invoiceEmailDeliveriesTable)
    .values({
      id: randomUUID(),
      invoiceId,
      recipientType,
      recipientEmail,
      status: "sending",
      attemptedAt: now,
    })
    .onConflictDoUpdate({
      target: [invoiceEmailDeliveriesTable.invoiceId, invoiceEmailDeliveriesTable.recipientType],
      set: { recipientEmail, status: "sending", attemptedAt: now },
      setWhere: sql`${invoiceEmailDeliveriesTable.status} <> 'sent' and (${invoiceEmailDeliveriesTable.status} <> 'sending' or ${invoiceEmailDeliveriesTable.attemptedAt} < ${leaseExpiry})`,
    })
    .returning();
  return Boolean(claimed);
}

async function finalizeDeliveryAttempt(
  invoiceId: string,
  recipientType: RecipientType,
  outcome: { ok: boolean; providerMessageId?: string | null; error?: string },
): Promise<void> {
  await db
    .update(invoiceEmailDeliveriesTable)
    .set({
      status: outcome.ok ? "sent" : "failed",
      providerMessageId: outcome.providerMessageId ?? null,
      error: outcome.error ?? null,
      attemptedAt: new Date(),
    })
    .where(
      sql`${invoiceEmailDeliveriesTable.invoiceId} = ${invoiceId} and ${invoiceEmailDeliveriesTable.recipientType} = ${recipientType}`,
    );
}

// Records a terminal outcome directly, for cases with no external send to
// race (e.g. "no email on file") -- upserting here is a harmless no-op on
// repeat calls since there is no side effect to duplicate.
async function recordDeliveryAttempt(
  invoiceId: string,
  recipientType: RecipientType,
  recipientEmail: string,
  outcome: { ok: boolean; providerMessageId?: string | null; error?: string },
): Promise<void> {
  await db
    .insert(invoiceEmailDeliveriesTable)
    .values({
      id: randomUUID(),
      invoiceId,
      recipientType,
      recipientEmail,
      status: outcome.ok ? "sent" : "failed",
      providerMessageId: outcome.providerMessageId ?? null,
      error: outcome.error ?? null,
      attemptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [invoiceEmailDeliveriesTable.invoiceId, invoiceEmailDeliveriesTable.recipientType],
      set: {
        recipientEmail,
        status: outcome.ok ? "sent" : "failed",
        providerMessageId: outcome.providerMessageId ?? null,
        error: outcome.error ?? null,
        attemptedAt: new Date(),
      },
    });
}

// Attempts one recipient's send under the atomic claim -- returns without
// calling the provider at all when the claim isn't won (already sent, or
// another caller is actively sending within its lease).
async function attemptClaimedSend(
  invoice: Invoice,
  recipientType: RecipientType,
  recipientEmail: string,
  pdf: Buffer,
  filename: string,
  subject: string,
  html: string,
): Promise<void> {
  const claimed = await claimDeliveryAttempt(invoice.id, recipientType, recipientEmail);
  if (!claimed) return;
  const result = await sendInvoiceEmail({ to: recipientEmail, subject, html, pdf, filename });
  await finalizeDeliveryAttempt(
    invoice.id,
    recipientType,
    result.ok ? { ok: true, providerMessageId: result.providerMessageId } : { ok: false, error: result.error },
  );
}

function emailHtml(invoice: Invoice): string {
  const label = TYPE_LABELS[invoice.type] ?? invoice.type;
  return `<p>Hi${invoice.billingName ? ` ${invoice.billingName}` : ""},</p>
<p>Your payment for <strong>${label}</strong>${invoice.listingName ? ` on <strong>${invoice.listingName}</strong>` : ""} has been confirmed.</p>
<p>Invoice <strong>${invoice.invoiceNumber}</strong> is attached as a PDF for your records.</p>
<p>Thank you.</p>`;
}

function adminEmailHtml(invoice: Invoice): string {
  return `<p>A new invoice was generated.</p>
<p>Invoice ${invoice.invoiceNumber} — ${invoice.type} — ${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency}${
    invoice.listingName ? ` — ${invoice.listingName}` : ""
  }</p>`;
}

function refundEmailHtml(invoice: Invoice): string {
  const refunded = (invoice.refundedCents / 100).toFixed(2);
  const total = (invoice.totalCents / 100).toFixed(2);
  const label = invoice.status === "REFUNDED" ? "fully refunded" : "partially refunded";
  return `<p>Hi${invoice.billingName ? ` ${invoice.billingName}` : ""},</p>
<p>Invoice <strong>${invoice.invoiceNumber}</strong> (${total} ${invoice.currency}) has been ${label}: ${refunded} ${invoice.currency} refunded.</p>
<p>The updated invoice reflecting this refund is attached as a PDF for your records.</p>
<p>Thank you.</p>`;
}

function adminRefundEmailHtml(invoice: Invoice): string {
  const refunded = (invoice.refundedCents / 100).toFixed(2);
  return `<p>Invoice ${invoice.invoiceNumber} was updated after a refund.</p>
<p>Status: ${invoice.status} — ${refunded} ${invoice.currency} refunded of ${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency}.</p>`;
}

// Idempotent, retry-safe post-processing run after a payment's finalize()
// transaction has committed: generates the PDF if missing, then attempts
// each recipient's email independently. A failed or already-successful
// delivery is tracked per (invoice, recipient type) so calling this again
// (e.g. from a retry job) never re-sends a mail that already succeeded and
// never blocks on one recipient's failure to reach the other.
export async function deliverInvoice(invoiceId: string): Promise<void> {
  let invoice = await getInvoiceById(invoiceId);
  if (!invoice) {
    logger.error({ event: "INVOICE_DELIVERY_MISSING", invoiceId }, "Invoice not found for delivery");
    return;
  }
  try {
    invoice = await ensurePdf(invoice);
  } catch (error) {
    logger.error({ event: "INVOICE_PDF_GENERATION_FAILED", invoiceId, error: error instanceof Error ? error.message : error }, "Invoice PDF generation failed");
    return;
  }

  const pdf = await readInvoicePdf(invoice.pdfObjectPath!);
  const filename = `${invoice.invoiceNumber}.pdf`;

  if (invoice.billingEmail) {
    await attemptClaimedSend(
      invoice,
      "client",
      invoice.billingEmail,
      pdf,
      filename,
      `Payment confirmed — invoice ${invoice.invoiceNumber}`,
      emailHtml(invoice),
    );
  } else {
    await recordDeliveryAttempt(invoiceId, "client", "", { ok: false, error: "No verified email on file for this payer" });
  }

  const adminEmail = await getSiteSetting("invoiceAdminEmail");
  if (adminEmail) {
    await attemptClaimedSend(invoice, "admin", adminEmail, pdf, filename, `New invoice ${invoice.invoiceNumber}`, adminEmailHtml(invoice));
  } else {
    await recordDeliveryAttempt(invoiceId, "admin", "", { ok: false, error: "Invoice notification email is not configured in Site Settings" });
  }
}

// Idempotent, retry-safe: sends a refund-notice email (with the freshly
// regenerated PDF attached) whenever a payment's refund grows the
// invoice's refundedCents past what was already notified. The claim below
// is a single atomic UPDATE, so two concurrent/duplicate triggers for the
// same refund can never both send the notice -- only the caller whose
// update actually advances refundNotifiedCents proceeds.
export async function notifyInvoiceRefunded(invoiceId: string): Promise<void> {
  const [claimed] = await db
    .update(invoicesTable)
    .set({ refundNotifiedCents: sql`${invoicesTable.refundedCents}` })
    .where(sql`${invoicesTable.id} = ${invoiceId} and ${invoicesTable.refundNotifiedCents} < ${invoicesTable.refundedCents}`)
    .returning();
  if (!claimed) return;

  let invoice = claimed;
  try {
    invoice = await ensurePdf(invoice);
  } catch (error) {
    logger.error({ event: "INVOICE_REFUND_PDF_GENERATION_FAILED", invoiceId, error: error instanceof Error ? error.message : error }, "Refunded invoice PDF regeneration failed");
    return;
  }

  const pdf = await readInvoicePdf(invoice.pdfObjectPath!);
  const filename = `${invoice.invoiceNumber}.pdf`;

  if (invoice.billingEmail) {
    await attemptClaimedSend(
      invoice,
      "client_refund",
      invoice.billingEmail,
      pdf,
      filename,
      `Invoice ${invoice.invoiceNumber} updated — refund recorded`,
      refundEmailHtml(invoice),
    );
  }
  const adminEmail = await getSiteSetting("invoiceAdminEmail");
  if (adminEmail) {
    await attemptClaimedSend(
      invoice,
      "admin_refund",
      adminEmail,
      pdf,
      filename,
      `Invoice ${invoice.invoiceNumber} refunded`,
      adminRefundEmailHtml(invoice),
    );
  }
}

export function notifyInvoiceRefundedInBackground(invoiceId: string): void {
  notifyInvoiceRefunded(invoiceId).catch((error) => {
    logger.error({ event: "INVOICE_REFUND_NOTIFICATION_FAILED", invoiceId, error: error instanceof Error ? error.message : error }, "Invoice refund notification failed");
  });
}

// Call this only after the transaction that recorded the refund has
// committed. Safe to call unconditionally on every createRefund call: a
// missing invoice, or one whose refundedCents hasn't grown since the last
// notice (e.g. an idempotent replay), is a silent no-op.
export function triggerInvoiceRefundNotification(paymentId: string): void {
  getInvoiceForPayment(paymentId)
    .then((invoice) => {
      if (invoice) notifyInvoiceRefundedInBackground(invoice.id);
    })
    .catch((error) => {
      logger.error({ event: "INVOICE_LOOKUP_FAILED", paymentId, error: error instanceof Error ? error.message : error }, "Invoice lookup for refund notification failed");
    });
}

// Fire-and-forget wrapper for call sites that must never let invoice
// delivery affect the payment response -- errors are logged, not thrown.
export function deliverInvoiceInBackground(invoiceId: string): void {
  deliverInvoice(invoiceId).catch((error) => {
    logger.error({ event: "INVOICE_DELIVERY_FAILED", invoiceId, error: error instanceof Error ? error.message : error }, "Invoice delivery failed");
  });
}

// Call this only after the transaction that finalized the payment has
// committed (never from inside it) -- it looks up the invoice created for
// that payment and schedules delivery. Safe to call unconditionally on
// every code path that might have just finalized a payment: a missing
// invoice (payment never succeeded) or an already-delivered one are both
// silent no-ops, so this never duplicates a send.
export function triggerInvoiceDeliveryForPayment(paymentId: string): void {
  getInvoiceForPayment(paymentId)
    .then((invoice) => {
      if (invoice) deliverInvoiceInBackground(invoice.id);
    })
    .catch((error) => {
      logger.error({ event: "INVOICE_LOOKUP_FAILED", paymentId, error: error instanceof Error ? error.message : error }, "Invoice lookup for delivery failed");
    });
}
