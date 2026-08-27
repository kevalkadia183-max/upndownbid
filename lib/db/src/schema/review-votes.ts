import { text, timestamp, uniqueIndex, pgTable } from "drizzle-orm/pg-core";
import { reviewsTable } from "./reviews";

export const reviewVotesTable = pgTable(
  "review_votes",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("review_votes_review_user_unique").on(table.reviewId, table.userId),
  ],
);

export type ReviewVote = typeof reviewVotesTable.$inferSelect;