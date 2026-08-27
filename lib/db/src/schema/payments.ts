import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { listingsTable } from "./listings";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const paymentsTable = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    // Nullable: a deferred new-listing checkout (public campaign bid / public
    // listing creation) has no listing yet -- one is created atomically in
    // payments.ts's finalize() only once the payment succeeds, using the
    // draft stashed in `metadata.pendingListing`. Every other payment type
    // still references an existing listing from creation.
    listingId: text("listing_id").references(() => listingsTable.id, {
      onDelete: "restrict",
    }),
    campaignId: text("campaign_id").references(() => campaignsTable.id, {
      onDelete: "restrict",
    }),
    userId: text("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    provider: text("provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    providerPaymentId: text("provider_payment_id"),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    receiptEmail: text("receipt_email"),
    receiptNumber: text("receipt_number"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payments_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("payments_provider_payment_unique").on(
      table.provider,
      table.providerPaymentId,
    ),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
    check("payments_platform_fee_nonnegative", sql`${table.platformFeeCents} >= 0`),
    check(
      "payments_type_allowed",
      sql`${table.type} in ('OWNER_BID', 'COMMUNITY_BID', 'PENALTY', 'SPONSORSHIP')`,
    ),
    check(
      "payments_status_allowed",
      sql`${table.status} in ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'requires_reconciliation')`,
    ),
  ],
);

export type Payment = typeof paymentsTable.$inferSelect;

export const paymentEventsTable = pgTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    paymentId: text("payment_id").references(() => paymentsTable.id, {
      onDelete: "restrict",
    }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
  ],
);

export type PaymentEvent = typeof paymentEventsTable.$inferSelect;

export const refundsTable = pgTable(
  "payment_refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    providerRefundId: text("provider_refund_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payment_refunds_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("payment_refunds_provider_refund_unique").on(
      table.providerRefundId,
    ),
    check("payment_refunds_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payment_refunds_status_allowed",
      sql`${table.status} in ('pending', 'succeeded', 'failed')`,
    ),
  ],
);

export type PaymentRefund = typeof refundsTable.$inferSelect;

export const paymentReceiptsTable = pgTable(
  "payment_receipts",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    receiptNumber: text("receipt_number").notNull(),
    email: text("email"),
    amountCents: integer("amount_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_receipts_payment_unique").on(table.paymentId),
    uniqueIndex("payment_receipts_number_unique").on(table.receiptNumber),
  ],
);

export type PaymentReceipt = typeof paymentReceiptsTable.$inferSelect;