import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const listingsTable = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id"),
    ownerEmail: text("owner_email"),
    ownerName: text("owner_name"),
    creationPaymentId: text("creation_payment_id"),
    managementTokenHash: text("management_token_hash"),
    managementTokenExpiresAt: timestamp("management_token_expires_at", { withTimezone: true }),
    managementTokenRevokedAt: timestamp("management_token_revoked_at", { withTimezone: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    tagline: text("tagline").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    initials: text("initials").notNull(),
    accent: text("accent").notNull(),
    // Owner-uploaded brand logo, stored as an object-storage path
    // (`/objects/uploads/<uuid>`). Null means no logo was uploaded yet --
    // every render site must fall back to the initials/accent avatar.
    logoUrl: text("logo_url"),
    websiteUrl: text("website_url"),
    status: text("status").notNull().default("active"),
    // Granular moderation workflow state (active/pending_review/flagged/
    // suspended/removed) tracked alongside the legacy `status` column.
    // `status` remains the sole gate for public/ranking visibility so
    // existing queries are untouched; `moderationStatus` drives the admin
    // moderation UI and can be more granular without affecting ranking.
    moderationStatus: text("moderation_status").notNull().default("active"),
    moderationReason: text("moderation_reason"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedById: text("moderated_by_id"),
    ownerBidCents: integer("owner_bid_cents").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    demoVideoUrl: text("demo_video_url"),
    demoViewCount: integer("demo_view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("listings_slug_unique").on(table.slug),
    uniqueIndex("listings_canonical_website_url_unique").on(table.websiteUrl),
    check("listings_owner_bid_nonnegative", sql`${table.ownerBidCents} >= 0`),
  ],
);

export type Listing = typeof listingsTable.$inferSelect;