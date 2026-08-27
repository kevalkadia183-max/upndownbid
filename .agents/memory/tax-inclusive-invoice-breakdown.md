---
name: Tax-inclusive invoice breakdown
description: How invoice tax/VAT was modeled so totalCents never diverges from the actual charged amount.
---

Invoice `totalCents` must always equal `payment.amountCents` (the money actually charged/reconciled) — it is never invented or increased by tax. When a site-wide tax rate is configured, the existing total is split *inclusively* into `subtotalCents` + `taxCents` via `taxCents = round(amountCents * rate / (100 + rate))`. With no rate configured (including every pre-existing invoice), `taxCents` stays 0 and `subtotalCents` equals the full amount — identical to pre-tax-feature behavior, so old invoices never retroactively gain fake tax.

**Why:** an invoice must reconcile against the real charge for accounting/reimbursement purposes; adding tax on top would make the invoice total diverge from what was actually collected.

**How to apply:** any future change to invoice money fields (new fee types, discounts, etc.) should follow the same pattern — derive a breakdown from the immutable charged total, never adjust the total itself. Tax label is a free-text site setting (e.g. "VAT", "GST", "Tax") so the wording matches the business's region.

**Correction (superseded an earlier version of this decision):** the configured tax rate, tax label, and tax registration number are now snapshotted onto the invoice row itself at creation time (alongside `taxCents`), not fetched live from Site Settings at PDF-render time. Two real bugs forced this: (1) displaying a percentage *derived* from `taxCents/subtotalCents` drifts from the actually-configured rate because those are rounded whole cents (e.g. 18% of an odd total can derive back out as "18.06%"); (2) fetching label/registration number live means an admin editing Site Settings after issuance silently rewrites what an already-issued invoice says. Only business identity fields with no compliance-number semantics (name/address/support email) stay live-fetched. Automated PDF-content assertions need `pdf-parse`'s `PDFParse` class (`new PDFParse({ data: buffer }); await parser.getText()`) — pdfkit compresses content streams by default, so a raw buffer string search never finds the rendered text.
