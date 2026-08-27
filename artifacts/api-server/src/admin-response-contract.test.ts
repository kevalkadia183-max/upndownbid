import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  db,
  feedbackTable,
  ledgerEntriesTable,
  listingClicksTable,
  listingsTable,
  rateLimitsTable,
  reportsTable,
  reviewsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetAdminOverviewResponse,
  ModerateReviewResponse,
  ResolveFeedbackResponse,
  ResolveReportResponse,
  SearchAdminUsersResponse,
  UpdateAdminListingStatusResponse,
  UpdateAdminUserRoleResponse,
  UpdateAdminUserStatusResponse,
  UpdateRateLimitResponse,
} from "@workspace/api-zod";
import { createApp } from "./app";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";

// This suite exists to catch the class of bug where a required field is added
// to a shared response schema (e.g. `Listing.clickAnalytics`) but an admin
// route that reuses/extends that schema is never updated to populate it.
// Backend `tsc` cannot catch that drift because the mismatch only surfaces
// when the route's `.parse()` call runs against a real payload, so these
// tests exercise the routes over real HTTP and validate the response body
// against the generated Zod response schema, exactly like a live client would.

// Clerk's Express middleware brands the function it installs on `req.auth`
// with this well-known symbol; `getAuth()` refuses to read anything that
// isn't branded this way. Using `Symbol.for` (not importing Clerk internals)
// reproduces the exact brand Clerk checks for, so this file can impersonate
// a signed-in session without any real Clerk credentials or network calls.
const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

function fakeAuthHandler(userId: string | null) {
  const handler = () => ({
    tokenType: "session_token",
    actor: null,
    // A verified email + email_verified claim short-circuits the app's
    // verifiedClerkEmail() helper before it would otherwise call out to the
    // real Clerk API for a user that does not exist there.
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
let adminClerkUserId = "";
let moderatorClerkUserId = "";
let listingId = "";
const createdUserIds: string[] = [];

// Dedicated member fixtures per mutating route, so that one route's mutation
// (e.g. promoting a member to moderator) can never change the role rank
// assumptions another route's test depends on.
let memberSearchId = "";
let memberSearchDisplayName = "";
let memberStatusId = "";
let memberRoleId = "";

let reviewLedgerEntryId = "";
let reviewId = "";
let reportId = "";
let feedbackId = "";

const RATE_LIMIT_ACTION = "review_vote";
let originalRateLimit: { maxRequests: number; windowSeconds: number } | null = null;

before(async () => {
  await ensureSignalRankSeed();

  adminClerkUserId = `clerk_admin_${randomUUID()}`;
  moderatorClerkUserId = `clerk_moderator_${randomUUID()}`;
  const adminId = `admin-contract-${randomUUID()}`;
  const moderatorId = `moderator-contract-${randomUUID()}`;
  memberSearchId = `member-search-contract-${randomUUID()}`;
  memberStatusId = `member-status-contract-${randomUUID()}`;
  memberRoleId = `member-role-contract-${randomUUID()}`;
  memberSearchDisplayName = `Contract Test Searchable Member ${randomUUID()}`;
  createdUserIds.push(adminId, moderatorId, memberSearchId, memberStatusId, memberRoleId);
  await db.insert(usersTable).values([
    {
      id: adminId,
      clerkUserId: adminClerkUserId,
      email: `${adminId}@example.test`,
      displayName: "Contract Test Admin",
      role: "admin",
      status: "active",
    },
    {
      id: moderatorId,
      clerkUserId: moderatorClerkUserId,
      email: `${moderatorId}@example.test`,
      displayName: "Contract Test Moderator",
      role: "moderator",
      status: "active",
    },
    {
      id: memberSearchId,
      clerkUserId: `clerk_member_search_${randomUUID()}`,
      email: `${memberSearchId}@example.test`,
      displayName: memberSearchDisplayName,
      role: "member",
      status: "active",
    },
    {
      id: memberStatusId,
      clerkUserId: `clerk_member_status_${randomUUID()}`,
      email: `${memberStatusId}@example.test`,
      displayName: "Contract Test Status Member",
      role: "member",
      status: "active",
    },
    {
      id: memberRoleId,
      clerkUserId: `clerk_member_role_${randomUUID()}`,
      email: `${memberRoleId}@example.test`,
      displayName: "Contract Test Role Member",
      role: "member",
      status: "active",
    },
  ]);

  listingId = `listing-contract-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id: listingId,
    name: "Contract Test Listing",
    slug: `contract-test-listing-${randomUUID()}`,
    tagline: "Exists purely to exercise admin response contracts.",
    description: "Seeded by the admin response contract test suite.",
    category: "Testing",
    initials: "CT",
    accent: "slate",
    ownerBidCents: 1000,
    clicks: 3,
  });
  await db.insert(listingClicksTable).values([
    { id: randomUUID(), listingId, visitorHash: "contract-visitor-a" },
    { id: randomUUID(), listingId, visitorHash: "contract-visitor-a" },
    { id: randomUUID(), listingId, visitorHash: "contract-visitor-b" },
  ]);

  reviewLedgerEntryId = `ledger-contract-${randomUUID()}`;
  await db.insert(ledgerEntriesTable).values({
    id: reviewLedgerEntryId,
    listingId,
    type: "COMMUNITY_BID",
    amountCents: 250,
  });
  reviewId = `review-contract-${randomUUID()}`;
  await db.insert(reviewsTable).values({
    id: reviewId,
    listingId,
    ledgerEntryId: reviewLedgerEntryId,
    kind: "support",
    displayName: "Contract Test Reviewer",
    rating: 5,
    reason: "Solid product",
    body: "Seeded by the admin response contract test suite.",
  });

  reportId = `report-contract-${randomUUID()}`;
  await db.insert(reportsTable).values({
    id: reportId,
    targetType: "listing",
    targetId: listingId,
    reason: "spam",
    details: "Seeded by the admin response contract test suite.",
  });

  feedbackId = `feedback-contract-${randomUUID()}`;
  await db.insert(feedbackTable).values({
    id: feedbackId,
    category: "bug",
    message: "Seeded by the admin response contract test suite.",
  });

  const [existingLimit] = await db
    .select()
    .from(rateLimitsTable)
    .where(eq(rateLimitsTable.action, RATE_LIMIT_ACTION))
    .limit(1);
  if (existingLimit) {
    originalRateLimit = {
      maxRequests: existingLimit.maxRequests,
      windowSeconds: existingLimit.windowSeconds,
    };
  }

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
  if (originalRateLimit) {
    await db
      .update(rateLimitsTable)
      .set(originalRateLimit)
      .where(eq(rateLimitsTable.action, RATE_LIMIT_ACTION));
  }
  if (feedbackId) {
    await db.delete(feedbackTable).where(eq(feedbackTable.id, feedbackId));
  }
  if (reportId) {
    await db.delete(reportsTable).where(eq(reportsTable.id, reportId));
  }
  if (reviewId) {
    await db.delete(reviewsTable).where(eq(reviewsTable.id, reviewId));
  }
  if (reviewLedgerEntryId) {
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, reviewLedgerEntryId));
  }
  if (listingId) {
    await db.delete(listingClicksTable).where(eq(listingClicksTable.listingId, listingId));
    await db.delete(listingsTable).where(eq(listingsTable.id, listingId));
  }
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("GET /api/admin/overview response contract", () => {
  it("rejects a request without a moderator/admin session", async () => {
    const response = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(response.status, 401);
  });

  it("returns 200 with a body that satisfies GetAdminOverviewResponse for a moderator", async () => {
    const response = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { "x-test-clerk-user-id": moderatorClerkUserId },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    // This is the guard against the shipped bug: if a required field is added
    // to Listing/Review and the admin serializer is not updated, this parse
    // throws instead of the failure only surfacing when a human opens the
    // live admin panel.
    const parsed = GetAdminOverviewResponse.parse(body);
    assert.equal(parsed.actorRole, "moderator");
    const listing = parsed.listings.find((item) => item.id === listingId);
    assert.ok(listing, "seeded listing should be present in admin overview");
    assert.deepEqual(listing?.clickAnalytics, { totalClicks: 3, uniqueClicks: 2 });
  });

  it("returns 200 with a body that satisfies GetAdminOverviewResponse for an admin", async () => {
    const response = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { "x-test-clerk-user-id": adminClerkUserId },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = GetAdminOverviewResponse.parse(body);
    assert.equal(parsed.actorRole, "admin");
  });
});

describe("PATCH /api/admin/listings/:id/status response contract", () => {
  it("returns a body that satisfies UpdateAdminListingStatusResponse, including click analytics", async () => {
    const response = await fetch(`${baseUrl}/api/admin/listings/${listingId}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ status: "active", reason: "contract test" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = UpdateAdminListingStatusResponse.parse(body);
    assert.equal(parsed.id, listingId);
    assert.deepEqual(parsed.clickAnalytics, { totalClicks: 3, uniqueClicks: 2 });
  });
});

describe("GET /api/admin/users response contract", () => {
  it("rejects a moderator without admin privileges", async () => {
    const response = await fetch(`${baseUrl}/api/admin/users?search=${encodeURIComponent(memberSearchDisplayName)}`, {
      headers: { "x-test-clerk-user-id": moderatorClerkUserId },
    });
    assert.equal(response.status, 403);
  });

  it("returns 200 with a body that satisfies SearchAdminUsersResponse for an admin", async () => {
    const response = await fetch(`${baseUrl}/api/admin/users?search=${encodeURIComponent(memberSearchDisplayName)}`, {
      headers: { "x-test-clerk-user-id": adminClerkUserId },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = SearchAdminUsersResponse.parse(body);
    const match = parsed.find((user) => user.id === memberSearchId);
    assert.ok(match, "seeded member should be found by member search");
    assert.equal(match?.role, "member");
  });
});

describe("PATCH /api/admin/users/:id/status response contract", () => {
  it("returns a body that satisfies UpdateAdminUserStatusResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/users/${memberStatusId}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ status: "suspended", reason: "contract test" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = UpdateAdminUserStatusResponse.parse(body);
    assert.equal(parsed.id, memberStatusId);
    assert.equal(parsed.status, "suspended");
  });
});

describe("PATCH /api/admin/users/:id/role response contract", () => {
  it("returns a body that satisfies UpdateAdminUserRoleResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/users/${memberRoleId}/role`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": adminClerkUserId,
      },
      body: JSON.stringify({ role: "moderator" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = UpdateAdminUserRoleResponse.parse(body);
    assert.equal(parsed.id, memberRoleId);
    assert.equal(parsed.role, "moderator");
  });
});

describe("PATCH /api/admin/reviews/:id/moderation response contract", () => {
  it("returns a body that satisfies ModerateReviewResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/reviews/${reviewId}/moderation`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ status: "hidden", reason: "contract test" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = ModerateReviewResponse.parse(body);
    assert.equal(parsed.id, reviewId);
    assert.equal(parsed.status, "hidden");
    assert.equal(parsed.moderationReason, "contract test");
  });
});

describe("PATCH /api/admin/reports/:id response contract", () => {
  it("returns a body that satisfies ResolveReportResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ status: "resolved", resolution: "contract test resolution" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = ResolveReportResponse.parse(body);
    assert.equal(parsed.id, reportId);
    assert.equal(parsed.status, "resolved");
    assert.ok(parsed.resolvedAt);
  });
});

describe("PATCH /api/admin/feedback/:id response contract", () => {
  it("returns a body that satisfies ResolveFeedbackResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/feedback/${feedbackId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ status: "dismissed", resolution: "contract test resolution" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = ResolveFeedbackResponse.parse(body);
    assert.equal(parsed.id, feedbackId);
    assert.equal(parsed.status, "dismissed");
  });
});

describe("PATCH /api/admin/limits/:action response contract", () => {
  it("returns a body that satisfies UpdateRateLimitResponse", async () => {
    const response = await fetch(`${baseUrl}/api/admin/limits/${RATE_LIMIT_ACTION}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "x-test-clerk-user-id": moderatorClerkUserId,
      },
      body: JSON.stringify({ maxRequests: 42, windowSeconds: 120 }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const parsed = UpdateRateLimitResponse.parse(body);
    assert.equal(parsed.action, RATE_LIMIT_ACTION);
    assert.equal(parsed.maxRequests, 42);
    assert.equal(parsed.windowSeconds, 120);
  });
});
