import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentsTable } from "./payments";
import { listingsTable } from "./listings";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

// One row per calendar year tracks the last sequence issued. The insert
// below is a single-row upsert that increments atomically under Postgres's
// row lock, so concurrent payment finalizations can never collide or skip a
// number -- this is the sole source of invoice numbers; they are never
// derived or accepted from the client.
export const invoiceCountersTable = pgTable("invoice_counters", {
  year: integer("year").primaryKey(),
  lastSequence: integer("last_sequence").notNull().default(0),
});

export type InvoiceCounter = typeof invoiceCountersTable.$inferSelect;

// A snapshot of the payment/listing/campaign/client details at the moment a
// payment is finalized as succeeded. Snapshotting (rather than joining live
// tables at render time) means a later listing edit, name change, or
// campaign rollover never rewrites what a previously issued invoice says --
// exactly like the existing `payment_receipts` table, but with a proper
// sequential invoice number and a stored PDF reference.
export const invoicesTable = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    listingId: text("listing_id").references(() => listingsTable.id, {
      onDelete: "restrict",
    }),
    campaignId: text("campaign_id").references(() => campaignsTable.id, {
      onDelete: "restrict",
    }),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "restrict",
    }),
    type: text("type").notNull(),
    status: text("status").notNull().default("PAID"),
    currency: text("currency").notNull().default("USD"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    // Snapshotted at invoice creation (same moment taxCents is computed),
    // never recomputed from taxCents/subtotalCents -- rounding the
    // charged amount into whole cents means deriving a percentage back
    // out of those cents can drift from the rate actually configured
    // (e.g. 18% of an odd total can print as "18.06%"). Storing the exact
    // configured rate/label/registration number here also means a later
    // change to Site Settings can never rewrite what an already-issued
    // invoice says, matching every other snapshotted field on this table.
    taxRatePercent: text("tax_rate_percent"),
    taxRegistrationNumber: text("tax_registration_number"),
    taxLabel: text("tax_label"),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    // The refundedCents value already communicated to the payer/admin via a
    // refund-notice email. A refund notification is only sent when
    // refundedCents has grown past this, and claiming the next notification
    // is a single atomic UPDATE ... WHERE refund_notified_cents < refunded_cents
    // (mirrors the invoice_counters atomic-increment pattern) so concurrent
    // callers can never both send the same refund notice.
    refundNotifiedCents: integer("refund_notified_cents").notNull().default(0),
    // The refundedCents value that was baked into the currently stored PDF.
    // Compared against the live refundedCents to decide whether a download
    // must regenerate the PDF -- this is what keeps a post-refund download
    // from ever serving a stale "PAID, $0 refunded" document.
    pdfRefundedCentsAtGeneration: integer("pdf_refunded_cents_at_generation"),
    billingName: text("billing_name"),
    billingEmail: text("billing_email"),
    listingName: text("listing_name"),
    listingWebsiteUrl: text("listing_website_url"),
    campaignNumber: integer("campaign_number"),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    reason: text("reason"),
    pdfObjectPath: text("pdf_object_path"),
    pdfGeneratedAt: timestamp("pdf_generated_at", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("invoices_invoice_number_unique").on(table.invoiceNumber),
    // A payment can never produce two invoices -- this is the idempotency
    // guarantee finalize() relies on for duplicate webhook deliveries.
    uniqueIndex("invoices_payment_unique").on(table.paymentId),
    index("invoices_user_index").on(table.userId),
    check(
      "invoices_status_allowed",
      sql`${table.status} in ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')`,
    ),
    check(
      "invoices_type_allowed",
      sql`${table.type} in ('OWNER_BID', 'COMMUNITY_BID', 'PENALTY', 'SPONSORSHIP')`,
    ),
    check("invoices_subtotal_positive", sql`${table.subtotalCents} > 0`),
    check("invoices_total_nonnegative", sql`${table.totalCents} >= 0`),
  ],
);

export type Invoice = typeof invoicesTable.$inferSelect;

// A durable log of every attempted delivery (client + admin, each tracked
// separately) so a failed send is visible, auditable, and safely retryable
// without ever duplicating the invoice or a prior successful send.
export const invoiceEmailDeliveriesTable = pgTable(
  "invoice_email_deliveries",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "restrict" }),
    recipientType: text("recipient_type").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    status: text("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("invoice_email_deliveries_invoice_index").on(table.invoiceId),
    // One row per (invoice, recipient type) -- a retry updates the existing
    // attempt in place instead of ever appending a second delivery record,
    // which is what keeps a resend from becoming a duplicate send.
    uniqueIndex("invoice_email_deliveries_invoice_recipient_unique").on(
      table.invoiceId,
      table.recipientType,
    ),
    // client_refund/admin_refund audit a refund-notice send (triggered when
    // refundedCents grows), kept separate from the original client/admin
    // "payment confirmed" delivery rows so each is independently retryable.
    check(
      "invoice_email_deliveries_recipient_type_allowed",
      sql`${table.recipientType} in ('client', 'admin', 'client_refund', 'admin_refund')`,
    ),
    // 'sending' is a short-lived claim state: only the caller whose atomic
    // upsert transitions a row into 'sending' may actually call the email
    // provider, which is what stops two concurrent/replayed deliveries
    // (e.g. a duplicate webhook) from both sending the same email before
    // either has recorded success. See claimDeliveryAttempt in invoices.ts.
    check(
      "invoice_email_deliveries_status_allowed",
      sql`${table.status} in ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export type InvoiceEmailDelivery = typeof invoiceEmailDeliveriesTable.$inferSelect;
