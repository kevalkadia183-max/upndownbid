import { Router, type IRouter } from "express";
import { z } from "zod";
import type { Invoice } from "@workspace/db";
import { requireActiveActor, requireModerator } from "../lib/moderation";
import { getInvoiceById, getInvoicePdfBuffer, listInvoicesForUser } from "../lib/invoices";

const router: IRouter = Router();

const invoiceIdParams = z.object({ id: z.string().min(1) });

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function invoiceResponse(invoice: Invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    paymentId: invoice.paymentId,
    listingId: invoice.listingId ?? null,
    listingName: invoice.listingName ?? null,
    listingWebsiteUrl: invoice.listingWebsiteUrl ?? null,
    campaignNumber: invoice.campaignNumber ?? null,
    type: invoice.type as "OWNER_BID" | "COMMUNITY_BID" | "PENALTY" | "SPONSORSHIP",
    status: invoice.status as "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED",
    currency: invoice.currency,
    subtotal: dollars(invoice.subtotalCents),
    tax: dollars(invoice.taxCents),
    platformFee: dollars(invoice.platformFeeCents),
    total: dollars(invoice.totalCents),
    refunded: dollars(invoice.refundedCents),
    billingName: invoice.billingName ?? null,
    billingEmail: invoice.billingEmail ?? null,
    provider: invoice.provider,
    reason: invoice.reason ?? null,
    pdfAvailable: Boolean(invoice.pdfObjectPath),
    issuedAt: invoice.issuedAt.toISOString(),
  };
}

router.get("/me/invoices", async (req, res): Promise<void> => {
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const invoices = await listInvoicesForUser(actor.id);
  res.json(invoices.map(invoiceResponse));
});

router.get("/me/invoices/:id/pdf", async (req, res): Promise<void> => {
  const params = invoiceIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid invoice id is required" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const invoice = await getInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (invoice.userId !== actor.id) {
    res.status(403).json({ error: "This invoice does not belong to the authenticated member" });
    return;
  }
  const result = await getInvoicePdfBuffer(invoice.id);
  if (!result) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.invoice.invoiceNumber}.pdf"`);
  res.send(result.pdf);
});

router.get("/admin/invoices/:id/pdf", async (req, res): Promise<void> => {
  const params = invoiceIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid invoice id is required" });
    return;
  }
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const result = await getInvoicePdfBuffer(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.invoice.invoiceNumber}.pdf"`);
  res.send(result.pdf);
});

export default router;
