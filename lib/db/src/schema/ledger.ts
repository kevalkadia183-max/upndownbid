import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { listingsTable } from "./listings";
import { paymentsTable } from "./payments";
import { campaignsTable } from "./campaigns";

export const ledgerEntriesTable = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "restrict" }),
    campaignId: text("campaign_id").references(() => campaignsTable.id, {
      onDelete: "restrict",
    }),
    userId: text("user_id"),
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("sandbox_verified"),
    provider: text("provider").notNull().default("sandbox"),
    providerTransactionId: text("provider_transaction_id"),
    paymentId: text("payment_id").references(() => paymentsTable.id, {
      onDelete: "restrict",
    }),
    providerEventId: text("provider_event_id"),
    refundOfLedgerEntryId: text("refund_of_ledger_entry_id"),
    idempotencyKey: text("idempotency_key"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ledger_entries_idempotency_unique").on(table.idempotencyKey),
    check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "ledger_entries_type_allowed",
      sql`${table.type} in ('OWNER_BID', 'COMMUNITY_BID', 'PENALTY', 'REFUND', 'PAYMENT_FEE', 'PLATFORM_FEE', 'ADJUSTMENT')`,
    ),
    check(
      "ledger_entries_status_allowed",
      sql`${table.status} in ('sandbox_verified', 'pending', 'verified', 'failed', 'refunded')`,
    ),
  ],
);

export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;