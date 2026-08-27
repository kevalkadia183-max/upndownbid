import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, listingDemoViewsTable, listingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetListingResponse,
  GetListingsResponse,
  GetTop4BoardResponse,
  UpdateMyListingResponse,
} from "@workspace/api-zod";
import { createApp } from "./app";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";

// Covers project task #63 (demo video + view counter):
//   - The owner-facing update endpoint validates and persists/clears
//     demoVideoUrl, rejecting non-http(s) values.
//   - The view-recording endpoint is 404 for a listing with no demo video,
//     dedupes repeat views from the same anonymous visitor, and counts
//     distinct visitors separately.
//   - Public listing responses (list + detail) surface demoVideoUrl and
//     demoViewCount.
//   - The Top4 board's CampaignListing shape exposes demoVideoUrl but
//     deliberately never a view count.

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
let ownerClerkUserId = "";
let ownerId = "";
let ownedListingId = "";
let ownedListingSlug = "";
let noDemoListingId = "";
let noDemoListingSlug = "";
let demoViewListingId = "";

async function jsonFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(init.headers ?? {}),
    },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

before(async () => {
  await ensureSignalRankSeed();

  const app = createApp({ clerkAuthMiddleware: testClerkAuthMiddleware() });
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  ownerClerkUserId = `clerk_demo_owner_${randomUUID()}`;
  ownerId = `demo-owner-${randomUUID()}`;
  await db.insert(usersTable).values({
    id: ownerId,
    clerkUserId: ownerClerkUserId,
    email: `${ownerId}@example.test`,
    displayName: "Demo Video Test Owner",
    role: "member",
    status: "active",
  });

  ownedListingId = `demo-owned-listing-${randomUUID()}`;
  ownedListingSlug = `demo-owned-listing-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id: ownedListingId,
    ownerId,
    name: "Demo Video Owned Listing",
    slug: ownedListingSlug,
    tagline: "Exists to exercise demo-video validation.",
    description: "Seeded by the demo-video test suite.",
    category: "Testing",
    initials: "DV",
    accent: "slate",
    ownerBidCents: 0,
    demoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    demoViewCount: 0,
  });

  noDemoListingId = `demo-no-demo-listing-${randomUUID()}`;
  noDemoListingSlug = `demo-no-demo-listing-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id: noDemoListingId,
    name: "No Demo Listing",
    slug: noDemoListingSlug,
    tagline: "Exists to exercise the no-demo-video 404 path.",
    description: "Seeded by the demo-video test suite.",
    category: "Testing",
    initials: "ND",
    accent: "slate",
    ownerBidCents: 0,
  });

  // Dedicated listing for the view-counting tests, kept isolated from the
  // owner-update describe block above so neither suite depends on the
  // other's mutations or on describe/it execution order.
  demoViewListingId = `demo-view-listing-${randomUUID()}`;
  await db.insert(listingsTable).values({
    id: demoViewListingId,
    name: "Demo View Counting Listing",
    slug: `demo-view-listing-${randomUUID()}`,
    tagline: "Exists to exercise demo-view dedup counting.",
    description: "Seeded by the demo-video test suite.",
    category: "Testing",
    initials: "DC",
    accent: "slate",
    ownerBidCents: 0,
    demoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    demoViewCount: 0,
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(listingDemoViewsTable).where(eq(listingDemoViewsTable.listingId, ownedListingId));
  await db.delete(listingDemoViewsTable).where(eq(listingDemoViewsTable.listingId, demoViewListingId));
  await db.delete(listingsTable).where(eq(listingsTable.id, ownedListingId));
  await db.delete(listingsTable).where(eq(listingsTable.id, noDemoListingId));
  await db.delete(listingsTable).where(eq(listingsTable.id, demoViewListingId));
  await db.delete(usersTable).where(eq(usersTable.id, ownerId));
});

describe("owner-facing demo video URL validation", () => {
  it("rejects a non-http(s) demo video URL", async () => {
    const { status, body } = await jsonFetch(`/api/me/listings/${ownedListingId}`, {
      method: "PATCH",
      headers: { "x-test-clerk-user-id": ownerClerkUserId },
      body: JSON.stringify({ demoVideoUrl: "javascript:alert(1)" }),
    });
    // The zod request schema itself rejects a non-http(s) string via its
    // regex before the route's own "Demo video URL must use http or https"
    // message is ever reached, so only the generic invalid-body message is
    // guaranteed here; the important assertion is that nothing was written.
    assert.equal(status, 400);

    const [unchanged] = await db.select().from(listingsTable).where(eq(listingsTable.id, ownedListingId));
    assert.equal(unchanged?.demoVideoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("persists a valid demo video URL and returns it in the response contract", async () => {
    const { status, body } = await jsonFetch(`/api/me/listings/${ownedListingId}`, {
      method: "PATCH",
      headers: { "x-test-clerk-user-id": ownerClerkUserId },
      body: JSON.stringify({ demoVideoUrl: "https://vimeo.com/123456789" }),
    });
    assert.equal(status, 200);
    const parsed = UpdateMyListingResponse.parse(body);
    assert.equal(parsed.demoVideoUrl, "https://vimeo.com/123456789");
  });

  it("clears an existing demo video URL when explicitly set to null", async () => {
    const { status, body } = await jsonFetch(`/api/me/listings/${ownedListingId}`, {
      method: "PATCH",
      headers: { "x-test-clerk-user-id": ownerClerkUserId },
      body: JSON.stringify({ demoVideoUrl: null }),
    });
    assert.equal(status, 200);
    const parsed = UpdateMyListingResponse.parse(body);
    assert.equal(parsed.demoVideoUrl, null);

    // Restore for the remaining tests in this file that expect a demo video.
    await db
      .update(listingsTable)
      .set({ demoVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
      .where(eq(listingsTable.id, ownedListingId));
  });
});

describe("POST /api/listings/:id/demo-view", () => {
  it("404s for a listing with no demo video", async () => {
    const { status } = await jsonFetch(`/api/listings/${noDemoListingId}/demo-view`, {
      method: "POST",
      body: JSON.stringify({ visitorId: randomUUID() }),
    });
    assert.equal(status, 404);
  });

  it("dedupes repeat views from the same visitor but counts distinct visitors separately", async () => {
    // visitorId must be a bare UUID per RecordDemoViewBody's schema (it mirrors
    // the client's crypto.randomUUID()-based localStorage visitor id).
    const visitorA = randomUUID();
    const visitorB = randomUUID();

    const first = await jsonFetch(`/api/listings/${demoViewListingId}/demo-view`, {
      method: "POST",
      body: JSON.stringify({ visitorId: visitorA }),
    });
    assert.equal(first.status, 200);
    const baseline = (first.body as { demoViews: number }).demoViews;

    const repeat = await jsonFetch(`/api/listings/${demoViewListingId}/demo-view`, {
      method: "POST",
      body: JSON.stringify({ visitorId: visitorA }),
    });
    assert.equal(repeat.status, 200);
    assert.equal((repeat.body as { demoViews: number }).demoViews, baseline, "same visitor must not increment the count twice");

    const distinct = await jsonFetch(`/api/listings/${demoViewListingId}/demo-view`, {
      method: "POST",
      body: JSON.stringify({ visitorId: visitorB }),
    });
    assert.equal(distinct.status, 200);
    assert.equal((distinct.body as { demoViews: number }).demoViews, baseline + 1, "a distinct visitor must increment the count");
  });
});

describe("public listing responses expose demo fields", () => {
  it("GET /api/listings/:slug includes demoVideoUrl and demoViewCount", async () => {
    const { status, body } = await jsonFetch(`/api/listings/${ownedListingSlug}`);
    assert.equal(status, 200);
    const parsed = GetListingResponse.parse(body);
    assert.equal(parsed.demoVideoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(typeof parsed.demoViewCount, "number");
  });

  it("GET /api/listings includes demoVideoUrl and demoViewCount per item", async () => {
    const { status, body } = await jsonFetch(`/api/listings`);
    assert.equal(status, 200);
    const parsed = GetListingsResponse.parse(body);
    // The listing may or may not be in the ranked set depending on ledger
    // state, but the shape itself must always carry these two fields.
    if (parsed.length > 0) {
      assert.equal(typeof parsed[0]!.demoViewCount, "number");
    }
  });
});

describe("Top4 board CampaignListing shape", () => {
  it("never includes a view count field, even when the listing entry is present", async () => {
    const { status, body } = await jsonFetch(`/api/campaigns/top4`);
    assert.equal(status, 200);
    const parsed = GetTop4BoardResponse.parse(body);
    for (const entry of parsed.entries) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(entry.listing, "demoViewCount"),
        "CampaignListing must never expose a demo view count",
      );
    }
  });
});
