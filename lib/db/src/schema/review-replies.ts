import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { reviewsTable } from "./reviews";
import { usersTable } from "./users";

export const reviewRepliesTable = pgTable(
  "review_replies",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewsTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("review_replies_review_unique").on(table.reviewId),
  ],
);

export type ReviewReply = typeof reviewRepliesTable.$inferSelect;