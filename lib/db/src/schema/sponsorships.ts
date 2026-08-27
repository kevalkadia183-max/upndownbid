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
import { usersTable } from "./users";
import { paymentsTable } from "./payments";

// Featured/Sponsored Listing slots -- a fully separate paid product from the
// weekly campaign ranking. Exactly 4 rotating slots exist at any time; slot
// allocation is enforced server-side inside an advisory-locked transaction
// (see SPONSORSHIP_LOCK_KEY in lib/sponsorships.ts), never trusted from the
// client. This table is deliberately isolated from campaignListings /
// campaignWinners / ledgerEntries -- campaign ranking must remain
// computable with zero knowledge of sponsorship data, and a sponsorship
// purchase must never influence ranking.
export const sponsorshipsTable = pgTable(
  "sponsorships",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listingsTable.id, { onDelete: "restrict" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    // Identifier 1-4. Not itself unique -- the same slot number is reused by
    // many sponsorships over time. "Which sponsorships currently occupy a
    // slot" (at most 4, active or a not-yet-stale pending reservation) is an
    // application-layer invariant enforced under the advisory lock, not a
    // database constraint, since a slot legitimately gets reassigned.
    slotNumber: integer("slot_number").notNull(),
    // pending: payment created but not yet confirmed succeeded. Counts
    // toward the 4-slot cap only until a short reservation TTL elapses (see
    // sweepExpiredSponsorships), so an abandoned checkout can't squat a slot
    // forever.
    // active: paid, currently occupying its slot, shown publicly.
    // expired: ran its full duration; freed by the scheduled sweep.
    // cancelled: payment never completed (reservation went stale or the
    // payment failed/was cancelled), or an active sponsorship was cancelled
    // early by its owner or an admin -- either way, its slot is free.
    status: text("status").notNull().default("pending"),
    priceCents: integer("price_cents").notNull(),
    durationDays: integer("duration_days").notNull(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    // Both null until the payment succeeds; set together, atomically, at
    // activation time based on server time -- never derived from anything
    // the client sends.
    startAt: timestamp("start_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("sponsorships_payment_id_unique").on(table.paymentId),
    index("sponsorships_status_index").on(table.status),
    index("sponsorships_listing_id_index").on(table.listingId),
    index("sponsorships_owner_id_index").on(table.ownerId),
    check("sponsorships_price_positive", sql`${table.priceCents} > 0`),
    check("sponsorships_duration_positive", sql`${table.durationDays} > 0`),
    check(
      "sponsorships_slot_number_range",
      sql`${table.slotNumber} between 1 and 4`,
    ),
    check(
      "sponsorships_status_allowed",
      sql`${table.status} in ('pending', 'active', 'expired', 'cancelled')`,
    ),
  ],
);

export type Sponsorship = typeof sponsorshipsTable.$inferSelect;

// Analytics for the sponsorship product: popup impressions, section
// impressions, and clicks. Modeled on listing_clicks / listing_spotlight_
// impressions' unenforced-index pattern (not listing_demo_views' dedup
// pattern) -- every occurrence is a distinct, meaningful event for
// impressions/clicks/CTR reporting, so the same visitor seeing the popup
// again in a later session still counts again.
export const sponsorshipEventsTable = pgTable(
  "sponsorship_events",
  {
    id: text("id").primaryKey(),
    sponsorshipId: text("sponsorship_id")
      .notNull()
      .references(() => sponsorshipsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sponsorship_events_sponsorship_id_index").on(table.sponsorshipId),
    index("sponsorship_events_sponsorship_type_index").on(
      table.sponsorshipId,
      table.type,
    ),
    check(
      "sponsorship_events_type_allowed",
      sql`${table.type} in ('popup_impression', 'section_impression', 'click')`,
    ),
  ],
);

export type SponsorshipEvent = typeof sponsorshipEventsTable.$inferSelect;
