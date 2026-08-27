import {
  db,
  ledgerEntriesTable,
  listingsTable,
  paymentsTable,
  policiesTable,
  rateLimitsTable,
  reportsTable,
  reviewsTable,
  siteSettingsTable,
  sponsorshipsTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { assignLegacyRecordsToCampaign, ensureCurrentCampaign } from "./campaigns";
import { DEFAULT_POLICIES, DEFAULT_SITE_SETTINGS } from "./policy-content";
import { DEFAULT_SPONSORSHIP_DURATION_DAYS, DEFAULT_SPONSORSHIP_PRICE_CENTS } from "./sponsorships";
import { ACCENT_PALETTE, isValidHexColor, resolveAccent } from "./accent-colors";

const demoListings = [
  {
    id: "lst_beacon",
    name: "Beacon",
    slug: "beacon",
    tagline: "A calmer command center for modern teams.",
    description:
      "Beacon keeps projects, decisions, and shared context visible without turning work into another noisy feed.",
    category: "Productivity",
    initials: "B",
    accent: ACCENT_PALETTE[4], // amber
    ownerBidCents: 18000,
    clicks: 2240,
    websiteUrl: "https://beacon.example.com",
    demoVideoUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    demoViewCount: 412,
  },
  {
    id: "lst_wildform",
    name: "Wildform",
    slug: "wildform",
    tagline: "Better storefront visuals without the studio overhead.",
    description:
      "Wildform helps small brands build a more expressive, conversion-ready visual catalog from the assets they already own.",
    category: "Commerce",
    initials: "W",
    accent: ACCENT_PALETTE[0], // coral
    ownerBidCents: 14500,
    clicks: 1830,
    websiteUrl: "https://wildform.example.com",
    demoVideoUrl: "https://www.youtube.com/watch?v=YE7VzlLtp-4",
    demoViewCount: 298,
  },
  {
    id: "lst_lumen",
    name: "Lumen",
    slug: "lumen",
    tagline: "Understand your home energy in real time.",
    description:
      "Lumen turns household energy data into simple choices that lower cost and reduce waste without a spreadsheet.",
    category: "Climate",
    initials: "L",
    accent: ACCENT_PALETTE[2], // blue
    ownerBidCents: 12000,
    clicks: 1690,
    websiteUrl: "https://lumen.example.com",
    demoVideoUrl: "https://www.youtube.com/watch?v=eRsGyueVLvQ",
    demoViewCount: 231,
  },
  {
    id: "lst_arcade",
    name: "Arcade North",
    slug: "arcade-north",
    tagline: "A living library for curious people.",
    description:
      "Arcade North is a member-supported discovery space for independent creators, small publishers, and overlooked ideas.",
    category: "Media",
    initials: "AN",
    accent: ACCENT_PALETTE[1], // violet
    ownerBidCents: 9800,
    clicks: 1380,
  },
  {
    id: "lst_kite",
    name: "Kite",
    slug: "kite",
    tagline: "Financial clarity for freelance life.",
    description:
      "Kite turns irregular income, taxes, and project profitability into a confident weekly check-in for independent workers.",
    category: "Finance",
    initials: "K",
    accent: ACCENT_PALETTE[3], // mint
    ownerBidCents: 8400,
    clicks: 1210,
    websiteUrl: "https://kite.example.com",
    demoVideoUrl: "https://www.youtube.com/watch?v=SkVqJ1SGeL0",
    demoViewCount: 176,
  },
];

// Which demo listings hold one of the 4 rotating Featured/Sponsored slots --
// a separate paid product from campaign ranking (see the module comment on
// lib/db/src/schema/sponsorships.ts). Deliberately not the same set as the
// current ranking leaders would suggest: sponsorship slot occupancy must
// never be confused with or derived from rank.
const demoSponsorships = [
  {
    id: "spn_beacon",
    listingId: "lst_beacon",
    ownerId: "usr_owner_beacon",
    slotNumber: 1,
    paymentId: "pay_spn_beacon",
    startedHoursAgo: 36,
  },
  {
    id: "spn_wildform",
    listingId: "lst_wildform",
    ownerId: "usr_owner_wildform",
    slotNumber: 2,
    paymentId: "pay_spn_wildform",
    startedHoursAgo: 30,
  },
  {
    id: "spn_lumen",
    listingId: "lst_lumen",
    ownerId: "usr_owner_lumen",
    slotNumber: 3,
    paymentId: "pay_spn_lumen",
    startedHoursAgo: 18,
  },
  {
    id: "spn_kite",
    listingId: "lst_kite",
    ownerId: "usr_owner_kite",
    slotNumber: 4,
    paymentId: "pay_spn_kite",
    startedHoursAgo: 6,
  },
] as const;

const initialLedger = [
  ["txn_beacon_1", "lst_beacon", "COMMUNITY_BID", 9400, "Great product"],
  ["txn_beacon_2", "lst_beacon", "PENALTY", 1200, "Too expensive"],
  ["txn_wildform_1", "lst_wildform", "COMMUNITY_BID", 7800, "Great idea"],
  ["txn_lumen_1", "lst_lumen", "COMMUNITY_BID", 6500, "Useful"],
  ["txn_lumen_2", "lst_lumen", "PENALTY", 900, "Needs more polish"],
  ["txn_arcade_1", "lst_arcade", "COMMUNITY_BID", 5200, "Want to help it grow"],
  ["txn_arcade_2", "lst_arcade", "PENALTY", 1650, "Doesn't deserve its current position"],
  ["txn_kite_1", "lst_kite", "COMMUNITY_BID", 3900, "Supporting the owner"],
] as const;

const initialOwnerLedger = demoListings.map((listing) => [
  `txn_${listing.slug.replace(/-/g, "_")}_owner`,
  listing.id,
  "OWNER_BID",
  listing.ownerBidCents,
  "Initial sandbox owner bid",
] as const);

const demoUsers = [
  {
    id: "usr_moderator_ava",
    email: "ava@signalrank.local",
    displayName: "Ava Moderator",
    role: "moderator",
  },
  {
    id: "usr_owner_beacon",
    email: "maya@beacon.local",
    displayName: "Maya Chen",
    role: "member",
  },
  {
    id: "usr_owner_wildform",
    email: "sam@wildform.local",
    displayName: "Sam Rivera",
    role: "member",
  },
  {
    id: "usr_owner_lumen",
    email: "priya@lumen.local",
    displayName: "Priya Nair",
    role: "member",
  },
  {
    id: "usr_owner_kite",
    email: "jordan@kite.local",
    displayName: "Jordan Blake",
    role: "member",
  },
  {
    id: "usr_member_elliot",
    email: "elliot@signalrank.local",
    displayName: "Elliot Park",
    role: "member",
  },
] as const;

const defaultRateLimits = [
  { action: "support", maxRequests: 8, windowSeconds: 60 },
  { action: "penalize", maxRequests: 5, windowSeconds: 60 },
  { action: "report", maxRequests: 4, windowSeconds: 300 },
  { action: "feedback", maxRequests: 5, windowSeconds: 300 },
  { action: "create_listing", maxRequests: 2, windowSeconds: 3600 },
  { action: "review", maxRequests: 5, windowSeconds: 3600 },
  { action: "review_vote", maxRequests: 30, windowSeconds: 60 },
] as const;

async function ensurePolicySeed(): Promise<void> {
  await db
    .insert(policiesTable)
    .values(
      DEFAULT_POLICIES.map((policy) => ({
        policyType: policy.policyType,
        title: policy.title,
        content: policy.content,
        version: 1,
        status: "published",
        publishedAt: new Date(),
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(siteSettingsTable)
    .values(
      Object.entries(DEFAULT_SITE_SETTINGS).map(([key, value]) => ({
        key,
        value,
      })),
    )
    .onConflictDoNothing();
}

let legacyAccentRepair: Promise<void> | undefined;

// Seeds the 4 rotating Featured/Sponsored slots as already-paid, active
// sponsorships -- a backing payment row per sponsorship, mirroring how
// initialLedger/initialOwnerLedger insert ledger entries directly rather
// than through the real bid-placement endpoints. The real /sponsorships/
// checkout flow requires an authenticated owner whose Clerk account matches
// listing.ownerId, which demo listings deliberately don't have, so demo
// sponsorships are inserted directly instead, exactly like the rest of this
// file's fake content.
export async function ensureSponsorshipSeed(): Promise<void> {
  const priceCents = DEFAULT_SPONSORSHIP_PRICE_CENTS;
  const durationDays = DEFAULT_SPONSORSHIP_DURATION_DAYS;

  // Backfills the sponsor card's website/demo-video/view-count display
  // fields onto whichever sponsored demo listings don't have them yet.
  // These listings already existed (from an earlier seed run before these
  // fields were added), so the listingsTable insert's onConflictDoNothing
  // above never touches them -- only update a still-empty field, so a real
  // claimed owner's own values are never overwritten.
  for (const listing of demoListings) {
    if (!listing.websiteUrl && !listing.demoVideoUrl && !listing.demoViewCount) continue;
    await db
      .update(listingsTable)
      .set({
        websiteUrl: sql`coalesce(${listingsTable.websiteUrl}, ${listing.websiteUrl ?? null})`,
        demoVideoUrl: sql`coalesce(${listingsTable.demoVideoUrl}, ${listing.demoVideoUrl ?? null})`,
        demoViewCount: sql`case when ${listingsTable.demoViewCount} = 0 then ${listing.demoViewCount ?? 0} else ${listingsTable.demoViewCount} end`,
      })
      .where(eq(listingsTable.id, listing.id));
  }

  await db
    .insert(paymentsTable)
    .values(
      demoSponsorships.map((sponsorship) => ({
        id: sponsorship.paymentId,
        listingId: sponsorship.listingId,
        userId: sponsorship.ownerId,
        type: "SPONSORSHIP",
        amountCents: priceCents,
        provider: "sandbox",
        status: "succeeded",
        idempotencyKey: `seed_${sponsorship.paymentId}`,
        reason: `Featured sponsorship — slot ${sponsorship.slotNumber}`,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(sponsorshipsTable)
    .values(
      demoSponsorships.map((sponsorship) => {
        const startAt = new Date(Date.now() - sponsorship.startedHoursAgo * 60 * 60 * 1000);
        const expiresAt = new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
        return {
          id: sponsorship.id,
          listingId: sponsorship.listingId,
          ownerId: sponsorship.ownerId,
          slotNumber: sponsorship.slotNumber,
          status: "active",
          priceCents,
          durationDays,
          paymentId: sponsorship.paymentId,
          startAt,
          expiresAt,
        };
      }),
    )
    .onConflictDoNothing();
}

export async function ensureSignalRankSeed(): Promise<void> {
  const campaign = await ensureCurrentCampaign();
  await assignLegacyRecordsToCampaign(campaign.id);
  await normalizeLegacyListingAccentsOnce();
  await ensurePolicySeed();
  await db
    .insert(rateLimitsTable)
    .values([...defaultRateLimits])
    .onConflictDoUpdate({
      target: rateLimitsTable.action,
      set: {
        maxRequests: sql`excluded.max_requests`,
        windowSeconds: sql`excluded.window_seconds`,
      },
    });

  // Everything below this point creates fake demo content (users, listings,
  // reviews, ledger entries). It is a one-time local-dev convenience and
  // must never run automatically against production or an intentionally
  // emptied database -- this function is called on nearly every request via
  // router middleware, so without this gate a cleared database (e.g. ahead
  // of a production launch) would silently repopulate with fake listings on
  // the very next request. It only runs in the automated test suite
  // (NODE_ENV=test, which expects fresh seed data every run) or when a
  // developer explicitly opts in with SEED_DEMO_DATA=true.
  const shouldSeedDemoContent =
    process.env.NODE_ENV === "test" || process.env.SEED_DEMO_DATA === "true";
  if (!shouldSeedDemoContent) return;

  await db.insert(usersTable).values([...demoUsers]).onConflictDoNothing();

  const [existing] = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .limit(1);

  if (existing) {
    await db.insert(ledgerEntriesTable).values(
      initialOwnerLedger.map(([id, listingId, type, amountCents, reason]) => ({
        id,
        listingId,
        campaignId: campaign.id,
        type,
        amountCents,
        reason,
        provider: "sandbox",
        status: "sandbox_verified",
      })),
    ).onConflictDoNothing();
    await db
      .insert(reportsTable)
      .values({
        id: "rpt_arcade_review",
        reporterId: "usr_member_elliot",
        targetType: "review",
        targetId: "rev_arcade_1",
        reason: "Potentially abusive language",
        details: "Please review the tone and relevance of this penalty signal.",
        status: "open",
      })
      .onConflictDoNothing();
    // Skipped under the automated test suite: sponsorships.test.ts exercises
    // the real 4-slot cap against fresh listings/owners it creates itself,
    // and never cleans up these fixed-id demo rows -- seeding them here
    // would permanently occupy all 4 slots and break every purchase in that
    // suite. This is purely a local-dev preview convenience.
    if (process.env.NODE_ENV !== "test") await ensureSponsorshipSeed();
    return;
  }

  await db.insert(listingsTable).values(demoListings).onConflictDoNothing();
  await db.insert(ledgerEntriesTable).values(
    [...initialLedger, ...initialOwnerLedger].map(([id, listingId, type, amountCents, reason], index) => ({
      id,
      listingId,
      campaignId: campaign.id,
      type,
      amountCents,
      reason,
      userId: `demo_supporter_${index + 1}`,
      createdAt: new Date(Date.now() - (index + 1) * 60 * 60 * 1000),
    })),
  ).onConflictDoNothing();

  const [beaconLedger] = await db
    .select({ id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, "txn_beacon_1"));
  const [lumenLedger] = await db
    .select({ id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, "txn_lumen_2"));
  const [arcadeLedger] = await db
    .select({ id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, "txn_arcade_2"));

  if (beaconLedger && lumenLedger && arcadeLedger) {
    await db.insert(reviewsTable).values([
      {
        id: "rev_beacon_1",
        listingId: "lst_beacon",
        campaignId: campaign.id,
        ledgerEntryId: beaconLedger.id,
        kind: "support",
        displayName: "Mira",
        rating: 5,
        reason: "Great product",
        body: "It makes a busy week feel visibly less chaotic.",
      },
      {
        id: "rev_lumen_1",
        listingId: "lst_lumen",
        campaignId: campaign.id,
        ledgerEntryId: lumenLedger.id,
        kind: "penalty",
        displayName: "Anonymous",
        rating: 3,
        reason: "Needs more polish",
        body: "The idea is strong, but onboarding needs to become much clearer.",
      },
      {
        id: "rev_arcade_1",
        listingId: "lst_arcade",
        campaignId: campaign.id,
        ledgerEntryId: arcadeLedger.id,
        kind: "penalty",
        displayName: "Robin",
        rating: 3,
        reason: "Doesn't deserve its current position",
        body: "I like the mission, but the membership pitch is still hard to understand.",
      },
    ]).onConflictDoNothing();
  }

  await db
    .insert(reportsTable)
    .values({
      id: "rpt_arcade_review",
      reporterId: "usr_member_elliot",
      targetType: "review",
      targetId: "rev_arcade_1",
      reason: "Potentially abusive language",
      details: "Please review the tone and relevance of this penalty signal.",
      status: "open",
    })
    .onConflictDoNothing();

  // See the matching comment in the `existing` branch above: skipped under
  // the automated test suite so sponsorships.test.ts's own fresh fixtures
  // always find free slots.
  if (process.env.NODE_ENV !== "test") await ensureSponsorshipSeed();

  logger.info("Seeded SignalRank development data");
}

async function normalizeLegacyListingAccentsOnce(): Promise<void> {
  if (!legacyAccentRepair) {
    legacyAccentRepair = (async () => {
      const staleRows = await db
        .select({ id: listingsTable.id, name: listingsTable.name, accent: listingsTable.accent })
        .from(listingsTable)
        .where(sql`${listingsTable.accent} !~ '^#[0-9a-fA-F]{6}$'`);
      const invalidRows = staleRows.filter((row) => !isValidHexColor(row.accent));
      if (invalidRows.length === 0) return;
      await Promise.all(
        invalidRows.map((row) =>
          db
            .update(listingsTable)
            .set({ accent: resolveAccent(row.accent, row.name) })
            .where(eq(listingsTable.id, row.id)),
        ),
      );
      logger.info({ count: invalidRows.length }, "Normalized legacy listing accent colors");
    })();
    // If the one-time repair itself fails, don't let a permanently-rejected
    // promise wedge every future request that awaits this cache -- clear it
    // so the next call retries instead of every request failing forever.
    legacyAccentRepair.catch(() => {
      legacyAccentRepair = undefined;
    });
  }
  await legacyAccentRepair;
}
