import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const siteVisitsTable = pgTable(
  "site_visits",
  {
    id: text("id").primaryKey(),
    visitorHash: text("visitor_hash").notNull(),
    sessionHash: text("session_hash").notNull(),
    path: text("path").notNull().default("/"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("site_visits_visitor_session_unique").on(
      table.visitorHash,
      table.sessionHash,
    ),
    index("site_visits_created_at_index").on(table.createdAt),
  ],
);

export type SiteVisit = typeof siteVisitsTable.$inferSelect;