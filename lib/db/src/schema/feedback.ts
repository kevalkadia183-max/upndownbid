import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Public "report a problem" channel (payment failure, site bug, or general
// feedback) -- distinct from the listing/review `reports` table in
// moderation.ts. A submission is anonymous-capable: userId/contactEmail are
// only filled when known, never required.
export const feedbackTable = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    message: text("message").notNull(),
    contactEmail: text("contact_email"),
    userId: text("user_id"),
    path: text("path"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedById: text("resolved_by_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("feedback_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export type Feedback = typeof feedbackTable.$inferSelect;
