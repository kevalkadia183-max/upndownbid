import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  db,
  ledgerEntriesTable,
  listingsTable,
  reviewsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetAdminOverviewResponse,
  GetListingResponse,
} from "@workspace/api-zod";
import { createApp } from "./app";
import { ensureCurrentCampaign } from "./lib/campaigns";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";

// Guards the fix for a suspended member's review continuing to inflate a
// listing's public rating/review count (and the admin overview's mirrored
// per-listing rating) after the member is banned. Ledger-entry dollar totals
// (effectiveBid/ownerBid/support/penalties) are deliberately NOT asserted
// here to stay unfiltered: they must remain identical to the verified-payment
// totals the weekly rollover finalizes regardless of a bidder's later account
// status (see closeCampaign in lib/campaigns.ts).

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

function fakeAuthHandler(userId: string | null) {
  const handler = () => ({
    tokenType: "session_token",
    actor: null,
    sessionClaims: userId ? { email: `${userId}@example.test`, email_verified: true } : null,
    sessionId: userId ? `sess_${userId}` : null,
    sessionStatus: userId ? "active" : null,
    userId,
    orgId: null,
    orgRole: null,
    orgSlug: null,
    orgPermissions: null,
    factorVerificationAge: null,
    getToken: async () => null,
    has: () => false,
    debug: () => ({}),
    isAuthenticated: Boolean(userId),
  });
  return Object.assign(handler, { [CLERK_AUTH_BRAND]: true });
}

function testClerkAuthMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const testUserId = req.header("x-test-clerk-user-id") ?? null;
    (req as unknown as { auth: unknown }).auth = fakeAuthHandler(testUserId);
    next();
  };
}

let server: Server;
let baseUrl = "";
let moderatorClerkUserId = "";
let listingId = "";
let listingSlug = "";
let activeUserId = "";
let suspendedUserId = "";
let activeLedgerEntryId = "";
let suspendedLedgerEntryId = "";
let activeReviewId = "";
let suspendedReviewId = "";
const createdUserIds: string[] = [];

before(async () => {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();

  moderatorClerkUserId = `clerk_moderator_${randomUUID()}`;
  const moderatorId = `moderator-scoping-${randomUUID()}`;
  activeUserId = `member-scoping-active-${randomUUID()}`;
  suspendedUserId = `member-scoping-suspended-${randomUUID()}`;
  createdUserIds.push(moderatorId, activeUserId, suspendedUserId);
  await db.insert(usersTable).values([
    {
      id: moderatorId,
      clerkUserId: moderatorClerkUserId,
      email: `${moderatorId}@example.test`,
      displayName: "Scoping Test Moderator",
      role: "moderator",
      status: "active",
    },
    {
      id: activeUserId,
      email: `${activeUserId}@example.test`,
      displayName: "Scoping Test Active Reviewer",
      role: "member",
      status: "active",
    },
    {
      id: suspendedUserId,
      email: `${suspendedUserId}@example.test`,
      displayName: "Scoping Test Suspended Reviewer",
      role: "member",
      status: "suspended",
    },
  ]);

  listingId = `listing-scoping-${randomUUID()}`;
  listingSlug = `scoping-test-listing-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id: listingId,
    name: "Scoping Test Listing",
    slug: listingSlug,
    tagline: "Exists purely to exercise archived/banned scoping.",
    description: "Seeded by the archived/banned scoping test suite.",
    category: "Testing",
    initials: "ST",
    accent: "slate",
    ownerBidCents: 0,
  });

  activeLedgerEntryId = `ledger-scoping-active-${randomUUID()}`;
  suspendedLedgerEntryId = `ledger-scoping-suspended-${randomUUID()}`;
  await db.insert(ledgerEntriesTable).values([
    {
      id: activeLedgerEntryId,
      listingId,
      campaignId: campaign.id,
      userId: activeUserId,
      type: "COMMUNITY_BID",
      amountCents: 500,
      status: "verified",
    },
    {
      id: suspendedLedgerEntryId,
      listingId,
      campaignId: campaign.id,
      userId: suspendedUserId,
      type: "COMMUNITY_BID",
      amountCents: 500,
      status: "verified",
    },
  ]);

  activeReviewId = `review-scoping-active-${randomUUID()}`;
  suspendedReviewId = `review-scoping-suspended-${randomUUID()}`;
  await db.insert(reviewsTable).values([
    {
      id: activeReviewId,
      listingId,
      campaignId: campaign.id,
      ledgerEntryId: activeLedgerEntryId,
      userId: activeUserId,
      kind: "support",
      displayName: "Scoping Test Active Reviewer",
      rating: 5,
      reason: "Great product",
      body: "Seeded by the archived/banned scoping test suite.",
      status: "published",
    },
    {
      id: suspendedReviewId,
      listingId,
      campaignId: campaign.id,
      ledgerEntryId: suspendedLedgerEntryId,
      userId: suspendedUserId,
      kind: "penalty",
      displayName: "Scoping Test Suspended Reviewer",
      rating: 1,
      reason: "Bug",
      body: "Seeded by a since-banned account; must not leak into public stats.",
      status: "published",
    },
  ]);

  const app = createApp({ clerkAuthMiddleware: testClerkAuthMiddleware() });
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(reviewsTable).where(eq(reviewsTable.id, activeReviewId));
  await db.delete(reviewsTable).where(eq(reviewsTable.id, suspendedReviewId));
  await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, activeLedgerEntryId));
  await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, suspendedLedgerEntryId));
  await db.delete(listingsTable).where(eq(listingsTable.id, listingId));
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("Suspended-member reviews are excluded from public/admin listing stats", () => {
  it("GET /api/listings/:slug only counts the review from the active reviewer", async () => {
    const response = await fetch(`${baseUrl}/api/listings/${listingSlug}`);
    assert.equal(response.status, 200);
    const parsed = GetListingResponse.parse(await response.json());
    assert.equal(parsed.reviewCount, 1);
    assert.equal(parsed.rating, 5);
    const reviews = parsed.reviews ?? [];
    assert.equal(reviews.length, 1);
    assert.ok(
      reviews.every((review) => review.author !== "Scoping Test Suspended Reviewer"),
      "the suspended reviewer's review must not appear on the public listing page",
    );
  });

  it("GET /api/admin/overview mirrors the same filtered rating for this listing", async () => {
    const response = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { "x-test-clerk-user-id": moderatorClerkUserId },
    });
    assert.equal(response.status, 200);
    const parsed = GetAdminOverviewResponse.parse(await response.json());
    const listing = parsed.listings.find((item) => item.id === listingId);
    assert.ok(listing, "seeded listing should be present in admin overview");
    assert.equal(listing?.reviewCount, 1);
    assert.equal(listing?.rating, 5);
    // The raw moderation review feed still surfaces every review, including
    // ones from suspended members, so moderators retain full audit context.
    const rawReviewIds = parsed.reviews.map((review) => review.id);
    assert.ok(rawReviewIds.includes(activeReviewId));
    assert.ok(rawReviewIds.includes(suspendedReviewId));
  });
});
