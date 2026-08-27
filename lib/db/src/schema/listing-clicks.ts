import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";

export const listingClicksTable = pgTable(
  "listing_clicks",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "cascade" }),
    visitorHash: text("visitor_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("listing_clicks_listing_id_index").on(table.listingId),
    index("listing_clicks_listing_visitor_index").on(
      table.listingId,
      table.visitorHash,
    ),
    index("listing_clicks_listing_created_index").on(
      table.listingId,
      table.createdAt,
    ),
  ],
);

export type ListingClick = typeof listingClicksTable.$inferSelect;
