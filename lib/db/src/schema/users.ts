import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id"),
    email: text("email"),
    displayName: text("display_name").notNull(),
    photoUrl: text("photo_url"),
    bio: text("bio"),
    company: text("company"),
    profileRole: text("profile_role"),
    socialLinks: text("social_links"),
    website: text("website"),
    location: text("location"),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_clerk_user_id_unique").on(table.clerkUserId),
  ],
);

export type User = typeof usersTable.$inferSelect;