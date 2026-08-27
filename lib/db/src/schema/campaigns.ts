import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { listingsTable } from "./listings";

export const campaignsTable = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    number: integer("number").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("live"),
    minimumBidCents: integer("minimum_bid_cents").notNull().default(500),
    winnerListingId: text("winner_listing_id").references(() => listingsTable.id, {
      onDelete: "restrict",
    }),
    winnerEffectiveBidCents: integer("winner_effective_bid_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("campaigns_number_unique").on(table.number),
    uniqueIndex("campaigns_start_unique").on(table.startAt),
    index("campaigns_status_end_index").on(table.status, table.endAt),
    check("campaigns_status_allowed", sql`${table.status} in ('live', 'completed')`),
    check("campaigns_valid_window", sql`${table.endAt} > ${table.startAt}`),
    check("campaigns_minimum_bid_positive", sql`${table.minimumBidCents} >= 100`),
  ],
);

export const campaignListingsTable = pgTable(
  "campaign_listings",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "restrict" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "restrict" }),
    ownerBidCents: integer("owner_bid_cents").notNull().default(0),
    supportTotalCents: integer("support_total_cents").notNull().default(0),
    penaltyTotalCents: integer("penalty_total_cents").notNull().default(0),
    effectiveBidCents: integer("effective_bid_cents").notNull().default(0),
    rank: integer("rank"),
    finalRank: integer("final_rank"),
    effectiveBidReachedAt: timestamp("effective_bid_reached_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("campaign_listings_campaign_listing_unique").on(
      table.campaignId,
      table.listingId,
    ),
    index("campaign_listings_campaign_rank_index").on(table.campaignId, table.rank),
  ],
);

export const campaignWinnersTable = pgTable(
  "campaign_winners",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "restrict" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "restrict" }),
    finalEffectiveBidCents: integer("final_effective_bid_cents").notNull(),
    finalRank: integer("final_rank").notNull().default(1),
    declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_winners_campaign_unique").on(table.campaignId),
    index("campaign_winners_listing_index").on(table.listingId),
  ],
);

export type Campaign = typeof campaignsTable.$inferSelect;
export type CampaignListing = typeof campaignListingsTable.$inferSelect;
export type CampaignWinner = typeof campaignWinnersTable.$inferSelect;