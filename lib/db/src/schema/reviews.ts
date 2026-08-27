import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";
import { ledgerEntriesTable } from "./ledger";
import { campaignsTable } from "./campaigns";

export const reviewsTable = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaignsTable.id, {
      onDelete: "restrict",
    }),
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntriesTable.id, { onDelete: "restrict" }),
    userId: text("user_id"),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull().default("Anonymous"),
    rating: integer("rating").notNull().default(5),
    reason: text("reason").notNull().default("Community signal"),
    body: text("body").notNull().default(""),
    helpfulCount: integer("helpful_count").notNull().default(0),
    status: text("status").notNull().default("published"),
    moderationReason: text("moderation_reason"),
    ownerReply: text("owner_reply"),
    ownerReplyAuthor: text("owner_reply_author"),
    ownerReplyAt: timestamp("owner_reply_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("reviews_ledger_entry_unique").on(table.ledgerEntryId)],
);

export type Review = typeof reviewsTable.$inferSelect;