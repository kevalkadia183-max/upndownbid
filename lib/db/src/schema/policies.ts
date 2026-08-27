import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The canonical set of policy documents Updownbid publishes. Content is
// stored here (not hardcoded in the frontend) so admins can edit and
// republish policy text without a code deploy. `policyType` is the primary
// key -- each document has exactly one current version, tracked via
// `version`/`publishedAt`; there is no separate version-history table.
export const policiesTable = pgTable("policies", {
  policyType: text("policy_type").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("published"),
  updatedById: text("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type Policy = typeof policiesTable.$inferSelect;

// A durable record that a specific user accepted a specific policy version
// in a specific context (e.g. submitting a listing, or paying for a
// campaign claim). This is intentionally minimal -- no free-form personal
// data -- and is written server-side at the moment of the underlying
// action, never trusted from the client beyond "the checkbox was checked".
export const policyAcceptancesTable = pgTable("policy_acceptances", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  policyType: text("policy_type").notNull(),
  policyVersion: integer("policy_version").notNull(),
  context: text("context").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PolicyAcceptance = typeof policyAcceptancesTable.$inferSelect;

// Small admin-configurable key/value config used by policy pages (grievance
// officer, support contact, business identity) so production values are
// supplied by the business owner through Admin -> Policies rather than
// invented in code.
export const siteSettingsTable = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSetting = typeof siteSettingsTable.$inferSelect;
