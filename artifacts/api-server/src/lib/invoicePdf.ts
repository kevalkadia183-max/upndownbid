import PDFDocument from "pdfkit";
import type { Invoice } from "@workspace/db";

// Presentation-only labels -- mirrors the labels already shown in the admin
// Transactions tab and owner portal. Never used for any business logic.
const TYPE_LABELS: Record<string, string> = {
  OWNER_BID: "Claim (Owner Bid)",
  COMMUNITY_BID: "Boost (Community Bid)",
  PENALTY: "Push Down (Penalty)",
};

const STATUS_LABELS: Record<string, string> = {
  PAID: "PAID",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY REFUNDED",
};

export type InvoiceBusinessDetails = {
  businessName: string | null;
  businessAddress: string | null;
  supportEmail: string | null;
};

function money(cents: number, currency: string): string {
  return `${(Math.round(cents) / 100).toFixed(2)} ${currency}`;
}

// Renders e.g. 18 or 7.5, never 18.00 -- Number#toString() already drops
// trailing zeros, which is all trimming this needs.
function formatPercent(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

// Renders a single-page branded invoice PDF into a Buffer. Every figure
// comes directly off the snapshotted invoice row -- taxCents/subtotalCents
// were split at invoice-creation time (see createInvoiceForFinalizedPayment)
// and are never recomputed here, so nothing in this file can change a
// payment amount, invent tax that wasn't configured when the invoice was
// issued, or alter a ledger entry.
export async function renderInvoicePdf(
  invoice: Invoice,
  business: InvoiceBusinessDetails,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const brand = "#4338CA";
  const businessName = business.businessName?.trim() || "UpDownBid";

  doc
    .fillColor(brand)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text(businessName, 50, 50)
    .fillColor("#111827")
    .fontSize(10)
    .font("Helvetica")
    .text(business.businessAddress?.trim() || "", 50, 78, { width: 260 });

  // Snapshotted on the invoice row at creation time (see
  // createInvoiceForFinalizedPayment), never read live from Site Settings
  // here -- a later change to the configured rate/label/registration
  // number must never rewrite what an already-issued invoice says.
  const taxLabel = invoice.taxLabel?.trim() || "Tax";
  const taxRegistrationNumber = invoice.taxRegistrationNumber?.trim();
  if (taxRegistrationNumber) {
    doc
      .fontSize(9)
      .fillColor("#4B5563")
      .text(`${taxLabel} reg. no: ${taxRegistrationNumber}`, 50, 106, { width: 260 })
      .fillColor("#111827");
  }

  doc
    .fillColor("#111827")
    .fontSize(20)
    .font("Helvetica-Bold")
    .text("INVOICE", 0, 50, { align: "right" })
    .fontSize(10)
    .font("Helvetica")
    .text(`Invoice #: ${invoice.invoiceNumber}`, { align: "right" })
    .text(`Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}`, { align: "right" })
    .fillColor(
      invoice.status === "PAID" ? "#15803D" : invoice.status === "PARTIALLY_REFUNDED" ? "#B45309" : "#B91C1C",
    )
    .font("Helvetica-Bold")
    .text(STATUS_LABELS[invoice.status] ?? invoice.status, { align: "right" });

  doc.moveDown(2);
  doc.fillColor("#111827");

  const detailsTop = 150;
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("Billed to", 50, detailsTop)
    .font("Helvetica")
    .fontSize(10)
    .text(invoice.billingName || "SignalRank member", 50, detailsTop + 16)
    .text(invoice.billingEmail || "No email on file", 50, detailsTop + 32);

  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("Listing", 300, detailsTop)
    .font("Helvetica")
    .fontSize(10)
    .text(invoice.listingName || "-", 300, detailsTop + 16, { width: 245 })
    .text(invoice.listingWebsiteUrl || "", 300, detailsTop + 32, { width: 245 });

  const campaignTop = detailsTop + 60;
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("Campaign", 50, campaignTop)
    .font("Helvetica")
    .fontSize(10)
    .text(invoice.campaignNumber ? `Weekly campaign #${invoice.campaignNumber}` : "-", 50, campaignTop + 16);

  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("Transaction", 300, campaignTop)
    .font("Helvetica")
    .fontSize(10)
    .text(`Type: ${TYPE_LABELS[invoice.type] ?? invoice.type}`, 300, campaignTop + 16, { width: 245 })
    .text(`Provider: ${invoice.provider}`, 300, campaignTop + 32, { width: 245 })
    .text(`Reference: ${invoice.providerPaymentId || invoice.paymentId}`, 300, campaignTop + 48, { width: 245 });

  const tableTop = campaignTop + 90;
  doc
    .moveTo(50, tableTop)
    .lineTo(545, tableTop)
    .strokeColor("#E5E7EB")
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Description", 50, tableTop + 10)
    .text("Amount", 0, tableTop + 10, { align: "right" });

  const rowTop = tableTop + 32;
  doc
    .font("Helvetica")
    .text(invoice.reason?.trim() || TYPE_LABELS[invoice.type] || "Payment", 50, rowTop, { width: 360 })
    .text(money(invoice.subtotalCents, invoice.currency), 0, rowTop, { align: "right" });

  let runningTop = rowTop + 22;
  if (invoice.platformFeeCents > 0) {
    doc
      .fillColor("#4B5563")
      .text("Platform fee (included above)", 50, runningTop, { width: 360 })
      .text(money(invoice.platformFeeCents, invoice.currency), 0, runningTop, { align: "right" })
      .fillColor("#111827");
    runningTop += 20;
  }
  if (invoice.taxCents > 0) {
    // The exact configured rate, snapshotted at issuance -- never derived
    // back out of subtotalCents/taxCents, which are whole cents and can
    // round the true rate away from a clean number (e.g. 18% of an odd
    // total would print as "18.06%" if derived from the rounded cents).
    const rate = invoice.taxRatePercent !== null ? Number(invoice.taxRatePercent) : null;
    const percent = rate !== null && Number.isFinite(rate) ? formatPercent(rate) : null;
    doc
      .text(`${taxLabel}${percent ? ` (${percent}%)` : ""}`, 50, runningTop, { width: 360 })
      .text(money(invoice.taxCents, invoice.currency), 0, runningTop, { align: "right" });
    runningTop += 20;
  }

  doc
    .moveTo(50, runningTop + 6)
    .lineTo(545, runningTop + 6)
    .strokeColor("#E5E7EB")
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Total", 50, runningTop + 16)
    .text(money(invoice.totalCents, invoice.currency), 0, runningTop + 16, { align: "right" });

  if (invoice.refundedCents > 0) {
    doc
      .fillColor("#B91C1C")
      .font("Helvetica")
      .fontSize(10)
      .text(`Refunded: ${money(invoice.refundedCents, invoice.currency)}`, 50, runningTop + 40, { align: "right", width: 495 })
      .fillColor("#111827");
  }

  const disclaimer =
    invoice.taxCents > 0
      ? `${taxLabel} of ${money(invoice.taxCents, invoice.currency)} is included in the total above. This invoice was generated automatically for a verified payment on UpDownBid.`
      : "This invoice was generated automatically for a verified payment on UpDownBid. No tax has been calculated or collected on this transaction.";
  doc
    .fontSize(8)
    .fillColor("#6B7280")
    .text(disclaimer, 50, 760, { width: 495, align: "center" })
    .text(
      business.supportEmail ? `Questions? Contact ${business.supportEmail}` : "",
      50,
      774,
      { width: 495, align: "center" },
    );

  doc.end();
  return done;
}
