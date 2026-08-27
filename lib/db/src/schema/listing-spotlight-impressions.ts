import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";

// Impression log for the homepage's featured-listing spotlight popup.
// Mirrors listing_clicks' unenforced-index pattern (not listing_demo_views'
// dedup pattern) because each session-gated popup showing is a distinct,
// meaningful impression -- the same listing being featured again in a later
// session should still count again, unlike a view count that must not be
// inflated by repeat requests from one browser.
export const listingSpotlightImpressionsTable = pgTable(
  "listing_spotlight_impressions",
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
    index("listing_spotlight_impressions_listing_id_index").on(table.listingId),
  ],
);

export type ListingSpotlightImpression = typeof listingSpotlightImpressionsTable.$inferSelect;
