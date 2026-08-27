import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";

// Dedup table for the demo-video view counter: one row per distinct visitor
// per listing. Mirrors site_visits' uniqueIndex + onConflictDoNothing
// pattern (rather than listing_clicks' unenforced index) because the counter
// must increment exactly once per visitor, not once per click.
export const listingDemoViewsTable = pgTable(
  "listing_demo_views",
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
    uniqueIndex("listing_demo_views_listing_visitor_unique").on(
      table.listingId,
      table.visitorHash,
    ),
    index("listing_demo_views_listing_id_index").on(table.listingId),
  ],
);

export type ListingDemoView = typeof listingDemoViewsTable.$inferSelect;
